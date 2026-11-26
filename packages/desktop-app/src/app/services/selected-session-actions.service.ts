import { Injectable } from "@angular/core";
import { AppProviderService } from "./app-provider.service";
import { SessionFactory } from "@noovolari/leapp-core/services/session-factory";
import { Session } from "@noovolari/leapp-core/models/session";
import { LoggedEntry, LoggedException, LogLevel, LogService } from "@noovolari/leapp-core/services/log-service";
import { BehaviouralSubjectService } from "@noovolari/leapp-core/services/behavioural-subject-service";
import { AwsSessionService } from "@noovolari/leapp-core/services/session/aws/aws-session-service";
import { ChangeRegionDialogComponent } from "../components/dialogs/change-region-dialog/change-region-dialog.component";
import { BsModalService } from "ngx-bootstrap/modal";
import { ChangeNamedProfileDialogComponent } from "../components/dialogs/change-named-profile-dialog/change-named-profile-dialog.component";
import { SsmModalDialogComponent } from "../components/dialogs/ssm-modal-dialog/ssm-modal-dialog.component";
import { EditDialogComponent } from "../components/dialogs/edit-dialog/edit-dialog.component";
import { constants } from "@noovolari/leapp-core/models/constants";
import { SessionType } from "@noovolari/leapp-core/models/session-type";
import { WindowService } from "./window.service";
import { OptionsService } from "./options.service";
import { AppService } from "./app.service";
import { MessageToasterService, ToastLevel } from "./message-toaster.service";
import { CreateDialogComponent } from "../components/dialogs/create-dialog/create-dialog.component";
import { AwsIamRoleFederatedSession } from "@noovolari/leapp-core/models/aws/aws-iam-role-federated-session";
import { AwsIamUserService } from "@noovolari/leapp-core/services/session/aws/aws-iam-user-service";
import { SessionService } from "@noovolari/leapp-core/services/session/session-service";
import { SessionStatus } from "@noovolari/leapp-core/models/session-status";

export interface SessionBatchResult {
  done: Session[];
  failed: Session[];
  // Left inactive because an earlier session in the batch uses the same named profile (only one can be active)
  sameProfile: Session[];
}

@Injectable({
  providedIn: "root",
})
export class SelectedSessionActionsService {
  private sessionFactory: SessionFactory;
  private logService: LogService;
  private behaviouralSubjectService: BehaviouralSubjectService;

  constructor(
    private appProviderService: AppProviderService,
    private modalService: BsModalService,
    private windowService: WindowService,
    private optionService: OptionsService,
    private appService: AppService,
    private messageToasterService: MessageToasterService
  ) {
    this.sessionFactory = this.appProviderService.sessionFactory;
    this.logService = this.appProviderService.logService;
    this.behaviouralSubjectService = this.appProviderService.behaviouralSubjectService;
  }

  getSelectedSessionService(session: Session): SessionService {
    return this.sessionFactory.getSessionService(session.type);
  }

  async startSession(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    this.logSessionData(session, "Starting Session");
    await this.getSelectedSessionService(session).start(session.sessionId);
    document.querySelector(".table thead tr").scrollIntoView();
  }

  async stopSession(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    this.logSessionData(session, `Stopped Session`);
    await this.getSelectedSessionService(session).stop(session.sessionId);
  }

  /**
   * Start the inactive sessions among `sessions` (a saved filter's), one after another: with AWS SSO the first one
   * signs in if needed and the rest reuse that token, and every start rewrites ~/.aws/credentials. Sessions that share
   * a named profile with an earlier one are left alone (starting them would stop it). A failure doesn't stop the rest.
   */
  async startSessions(sessions: Session[], label: string): Promise<SessionBatchResult> {
    this.behaviouralSubjectService.unselectSessions();
    const result: SessionBatchResult = { done: [], failed: [], sameProfile: [] };
    const profilesInBatch = new Set<string>();
    // An SSO session that fails (sign-in cancelled, portal unreachable) would fail, or reopen the sign-in, for every
    // other session of the same integration: skip those and report them as failed
    const failedIntegrations = new Set<string>();
    for (const session of sessions) {
      const current = this.behaviouralSubjectService.getSessionById(session.sessionId);
      if (!current || current.status !== SessionStatus.inactive) {
        continue;
      }
      const integrationId: string | undefined = (current as any).awsSsoConfigurationId;
      if (integrationId && failedIntegrations.has(integrationId)) {
        result.failed.push(current);
        continue;
      }
      const profileId: string | undefined = (current as any).profileId;
      if (profileId && profilesInBatch.has(profileId)) {
        result.sameProfile.push(current);
        continue;
      }
      if (profileId) {
        profilesInBatch.add(profileId);
      }
      try {
        this.logSessionData(current, `Starting Session (saved filter "${label}")`);
        await this.getSelectedSessionService(current).start(current.sessionId);
        const after = this.behaviouralSubjectService.getSessionById(current.sessionId);
        if (after?.status === SessionStatus.active) {
          result.done.push(current);
          continue;
        }
        result.failed.push(current);
      } catch (error) {
        result.failed.push(current);
        this.logService.log(new LoggedException(error?.message ?? `${error}`, this, LogLevel.warn, false, error?.stack));
      }
      if (integrationId) {
        failedIntegrations.add(integrationId);
      }
    }
    this.toastBatch(label, "started", result);
    return result;
  }

  /** Stop the active (or starting) sessions among `sessions`, one after another. */
  async stopSessions(sessions: Session[], label: string): Promise<SessionBatchResult> {
    this.behaviouralSubjectService.unselectSessions();
    const result: SessionBatchResult = { done: [], failed: [], sameProfile: [] };
    for (const session of sessions) {
      const current = this.behaviouralSubjectService.getSessionById(session.sessionId);
      if (!current || current.status === SessionStatus.inactive) {
        continue;
      }
      try {
        this.logSessionData(current, `Stopped Session (saved filter "${label}")`);
        await this.getSelectedSessionService(current).stop(current.sessionId);
        result.done.push(current);
      } catch (error) {
        result.failed.push(current);
        this.logService.log(new LoggedException(error?.message ?? `${error}`, this, LogLevel.warn, false, error?.stack));
      }
    }
    this.toastBatch(label, "stopped", result);
    return result;
  }

  async openAwsWebConsole(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    const credentials = await (this.getSelectedSessionService(session) as AwsSessionService).generateCredentials(session.sessionId);
    const sessionRegion = session.region;
    const sessionDuration = this.appProviderService.workspaceService.getWorkspace().samlRoleSessionDuration;
    await this.appProviderService.webConsoleService.openWebConsole(credentials, sessionRegion, sessionDuration);
  }

  async changeRegionModalOpen(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    this.modalService.show(ChangeRegionDialogComponent, {
      animated: false,
      class: "ssm-modal",
      initialState: { session },
    });
  }

  async changeProfileModalOpen(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    this.modalService.show(ChangeNamedProfileDialogComponent, {
      animated: false,
      class: "ssm-modal",
      initialState: { session },
    });
  }

  async ssmModalOpen(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    if (!(await this.appService.checkSsmRequirements())) {
      return;
    }
    this.modalService.show(SsmModalDialogComponent, {
      animated: false,
      class: "edit-modal ssm-instances-modal",
      initialState: { session },
    });
  }

  async editCurrentSession(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    this.modalService.show(EditDialogComponent, {
      animated: false,
      class: "edit-modal",
      initialState: { selectedSessionId: session.sessionId },
    });
  }

  async deleteSession(session: Session): Promise<void> {
    this.behaviouralSubjectService.unselectSessions();
    const dialogMessage = this.generateDeleteDialogMessage(session);
    this.windowService.confirmDialog(
      dialogMessage,
      async (status) => {
        try {
          if (status === constants.confirmed) {
            this.logSessionData(session, "Session Deleted");
            await this.getSelectedSessionService(session).delete(session.sessionId);

            this.messageToasterService.toast(`Session Deleted: ${session.sessionName}`, ToastLevel.success, "");
          }
        } catch (error) {
          this.messageToasterService.toast(error.message, ToastLevel.error);
        }
      },
      "Delete Session",
      "Cancel"
    );
  }

  async pinSession(session: Session): Promise<void> {
    this.optionService.pinSession(session);
    this.behaviouralSubjectService.unselectSessions();
  }

  async unpinSession(session: Session): Promise<void> {
    this.optionService.unpinSession(session);
    this.behaviouralSubjectService.unselectSessions();
  }

  isPinned(selectedSession: Session): boolean {
    return this.optionService.pinned.indexOf(selectedSession.sessionId) !== -1;
  }

  copyProfile(profileName: string): void {
    this.behaviouralSubjectService.unselectSessions();
    this.appService.copyToClipboard(profileName);
    this.messageToasterService.toast("Profile Name Copied", ToastLevel.success, "Information copied!");
  }

  logoutFromFederatedSession(session: Session): void {
    this.behaviouralSubjectService.unselectSessions();
    this.appProviderService.awsAuthenticationService.logoutFromFederatedSession(session, () => {
      this.logSessionData(session, `Stopped Session`);
    });
  }

  createAChainedSessionFromSelectedOne(session: Session): void {
    this.behaviouralSubjectService.unselectSessions();
    const aliasConstructed = `ChainedFrom${session.sessionName}`;
    const regionConstructed = session.region;
    const assumerSessionIdConstructed = session.sessionId;
    const assumerSessionNameConstructed = session.sessionName;
    const sessionName = session.sessionName.replace(/ /g, "-");
    const assumerSessionTagConstructed = `chained-from-${sessionName}`;

    const initialState = {
      shortcutAlias: aliasConstructed,
      shortcutRegion: regionConstructed,
      shortcutSessionId: assumerSessionIdConstructed,
      shortcutSessionName: assumerSessionNameConstructed,
      shortcutSessionTag: assumerSessionTagConstructed,
      shortcut: true,
    };

    this.modalService.show(CreateDialogComponent, {
      animated: false,
      class: "create-modal",
      backdrop: "static",
      keyboard: false,
      initialState,
    });
  }

  async copyCredentials(session: Session, type: number): Promise<void> {
    this.appProviderService.behaviouralSubjectService.unselectSessions();

    try {
      if (this.appProviderService.workspaceService.workspaceExists()) {
        const roleArn = (session as AwsIamRoleFederatedSession).roleArn;
        const texts = {
          // eslint-disable-next-line max-len
          1: roleArn ? `${roleArn.split("/")[0].substring(13, 25)}` : "",
          2: roleArn ? `${roleArn}` : "",
        };

        let text = texts[type];

        // Special conditions for IAM Users
        if (session.type === SessionType.awsIamUser) {
          // Get Account from Caller Identity
          text = await (this.getSelectedSessionService(session) as AwsIamUserService).getAccountNumberFromCallerIdentity(session);
        }

        this.appService.copyToClipboard(text);
        this.messageToasterService.toast("Copied to Clipboard", ToastLevel.success, "Information copied!");
      }
    } catch (err) {
      this.messageToasterService.toast(err, ToastLevel.warn);
      this.appProviderService.logService.log(new LoggedException(err, this, LogLevel.error, true, err.stack));
    }
  }

  async copyAwsWebConsoleUrl(session: Session): Promise<void> {
    this.appProviderService.behaviouralSubjectService.unselectSessions();

    try {
      const credentials = await (this.getSelectedSessionService(session) as AwsSessionService).generateCredentials(session.sessionId);
      const sessionRegion = session.region;
      const sessionDuration = this.appProviderService.workspaceService.getWorkspace().samlRoleSessionDuration;
      const loginURL = await this.appProviderService.webConsoleService.getWebConsoleUrl(credentials, sessionRegion, sessionDuration);

      this.appService.copyToClipboard(loginURL);
      this.messageToasterService.toast("Copied to Clipboard", ToastLevel.success, "Information copied!");
    } catch (err) {
      this.messageToasterService.toast(err, ToastLevel.warn);
      this.appProviderService.logService.log(new LoggedException(err, this, LogLevel.error, true, err.stack));
    }
  }

  private generateDeleteDialogMessage(session: Session): string {
    let dependentSessions = [];
    if (session.type !== SessionType.azure) {
      dependentSessions = this.getSelectedSessionService(session).getDependantSessions(session.sessionId);
    }

    let dependendSessionsHtml = "";
    dependentSessions.forEach((sess) => {
      dependendSessionsHtml += `<li><div class="removed-sessions"><b>${sess.sessionName}</b></div></li>`;
    });
    if (dependendSessionsHtml !== "") {
      return (
        "This session has dependent sessions: <br><ul>" +
        dependendSessionsHtml +
        "</ul><br>Removing the session will also remove the dependent sessions associated with it. Do you want to proceed?"
      );
    } else {
      return `Do you really want to delete the session '${session.sessionName}'?`;
    }
  }

  private logSessionData(session: Session, message: string): void {
    this.logService.log(
      new LoggedEntry(
        message,
        this,
        LogLevel.info,
        false,
        JSON.stringify({ timestamp: new Date().toISOString(), id: session.sessionId, account: session.sessionName, type: session.type }, null, 3)
      )
    );
  }

  private toastBatch(label: string, verb: "started" | "stopped", result: SessionBatchResult): void {
    const names = (list: Session[]) => list.map((session) => session.sessionName).join(", ");
    const total = result.done.length + result.failed.length;
    const count = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;
    if (total === 0 && result.sameProfile.length === 0) {
      return;
    }
    const parts = [result.failed.length === 0 ? `${count(result.done.length)} ${verb}.` : `${result.done.length} of ${count(total)} ${verb}.`];
    if (result.failed.length > 0) {
      parts.push(`Failed: ${names(result.failed)}.`);
    }
    if (result.sameProfile.length > 0) {
      parts.push(`Not started, named profile already used by another session in the filter: ${names(result.sameProfile)}.`);
    }
    const level = result.failed.length > 0 || result.sameProfile.length > 0 ? ToastLevel.warn : ToastLevel.success;
    this.messageToasterService.toast(parts.join(" "), level, label);
  }
}
