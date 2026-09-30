import { Component, Input, OnInit } from "@angular/core";
import { Session } from "@noovolari/leapp-core/models/session";
import { AppService } from "../../../services/app.service";
import { AppProviderService } from "../../../services/app-provider.service";
import { SessionFactory } from "@noovolari/leapp-core/services/session-factory";
import { AwsSessionService } from "@noovolari/leapp-core/services/session/aws/aws-session-service";
import { SsmPortForwarding, SsmService, ssmCommandForProfile, validatePortForwarding } from "@noovolari/leapp-core/services/ssm-service";
import { SsmTunnel } from "@noovolari/leapp-core/models/ssm-tunnel";
import * as uuid from "uuid";
import { LeappBaseError } from "@noovolari/leapp-core/errors/leapp-base-error";
import { LogLevel } from "@noovolari/leapp-core/services/log-service";
import { constants } from "@noovolari/leapp-core/models/constants";
import { withRecentRegions } from "../../../services/region-options";
import { MessageToasterService, ToastLevel } from "../../../services/message-toaster.service";
import { sidebarHighlight } from "../../side-bar/side-bar.component";
import { defaultTunnelName, emptyTunnelDraft, forwardingFrom, TunnelDraft } from "../../ssm-tunnels/tunnel-draft";

@Component({
  selector: "app-ssm-modal-dialog",
  templateUrl: "./ssm-modal-dialog.component.html",
  styleUrls: ["./ssm-modal-dialog.component.scss"],
})
export class SsmModalDialogComponent implements OnInit {
  @Input()
  public session: Session;
  public instances: any[];
  public instancesNotFiltered: any[];
  public ssmLoading: boolean;
  public askingSsmRegion: boolean;
  public selectedSsmRegion: string;
  public awsRegions: { region: string }[];
  // The instance whose port forwarding form is open, and the values typed in it
  public forwardingInstanceId: string | null = null;
  public forwarding: TunnelDraft = emptyTunnelDraft();
  public forwardingMessage: { text: string; error: boolean; showTunnels?: boolean } | null = null;

  private sessionFactory: SessionFactory;
  private ssmService: SsmService;

  constructor(private appService: AppService, private appProviderService: AppProviderService, private messageToasterService: MessageToasterService) {}

  get suggestLocalPort(): () => Promise<number> {
    return () => this.appProviderService.ssmTunnelService.suggestLocalPort();
  }

  get sessionService(): AwsSessionService {
    return this.sessionFactory.getSessionService(this.session.type) as AwsSessionService;
  }

  ngOnInit(): void {
    this.instances = [];
    this.ssmLoading = false;
    this.askingSsmRegion = true;
    this.selectedSsmRegion = null;
    this.awsRegions = withRecentRegions(this.appProviderService.awsCoreService.getRegions(), this.appProviderService.repository.getSessions());
    this.sessionFactory = this.appProviderService.sessionFactory;
    this.ssmService = this.appProviderService.ssmService;

    if (this.appProviderService.repository.getWorkspace().ssmRegionBehaviour === constants.ssmRegionDefault) {
      this.selectedSsmRegion = this.session.region;
      this.changeSsmRegion();
    }
  }

  closeModal(): void {
    this.appService.closeModal();
  }

  /**
   * Set the region for ssm init and launch the method form the server to find instances
   *
   * @param event - the change select event
   * @param session - The sessions in which the aws region need to change
   */
  async changeSsmRegion(): Promise<void> {
    // We have a valid SSM region
    if (this.selectedSsmRegion) {
      // Start process
      this.ssmLoading = true;
      this.askingSsmRegion = true;
      // Generate valid temporary credentials for the SSM and EC2 client
      const credentials = await (this.sessionService as AwsSessionService).generateCredentials(this.session.sessionId);
      // Get the instances
      try {
        this.instances = await this.ssmService.getSsmInstances(credentials, this.selectedSsmRegion);
        this.instancesNotFiltered = this.instances;
        this.askingSsmRegion = false;
      } catch (err) {
        this.instances = [];
        this.instancesNotFiltered = [];
        this.askingSsmRegion = true;
        throw new LeappBaseError("SSM Error", this, LogLevel.error, err.message);
      } finally {
        this.ssmLoading = false;
      }
    }
  }

  searchSSMInstance(event): void {
    if (event.target.value !== "") {
      this.instances = this.instancesNotFiltered.filter(
        (i) =>
          i.InstanceId.indexOf(event.target.value) > -1 || i.IPAddress.indexOf(event.target.value) > -1 || i.Name.indexOf(event.target.value) > -1
      );
    } else {
      this.instances = this.instancesNotFiltered;
    }
  }

  /**
   * Start a new ssm sessions
   *
   * @param sessionId - id of the sessions
   * @param instanceId - instance id to start ssm sessions
   */
  async startSsmSession(instanceId: string): Promise<void> {
    this.instances.forEach((instance) => {
      if (instance.InstanceId === instanceId) {
        instance.loading = true;
      }
    });

    // Generate valid temporary credentials for the SSM and EC2 client
    const credentials = await (this.sessionService as AwsSessionService).generateCredentials(this.session.sessionId);

    this.ssmService.startSession(credentials, instanceId, this.selectedSsmRegion);

    setTimeout(() => {
      this.instances.forEach((instance) => {
        if (instance.InstanceId === instanceId) {
          instance.loading = false;
        }
      });
    }, 4000);

    this.ssmLoading = false;
  }

  togglePortForwarding(instanceId: string): void {
    this.forwardingInstanceId = this.forwardingInstanceId === instanceId ? null : instanceId;
    this.forwardingMessage = null;
  }

  /**
   * Save the port forwarding as a tunnel and run it in the background
   *
   * @param instance - the instance that forwards the traffic
   */
  async startTunnel(instance: any): Promise<void> {
    const forwarding = this.validForwarding();
    if (!forwarding) {
      return;
    }
    const tunnelService = this.appProviderService.ssmTunnelService;
    if (!(await tunnelService.isLocalPortFree(forwarding.localPort))) {
      this.forwardingMessage = { text: `Local port ${forwarding.localPort} is already in use. Use another one.`, error: true };
      return;
    }
    const tunnel: SsmTunnel = {
      id: uuid.v4(),
      name: this.forwarding.name.trim() || defaultTunnelName(instance.Name, forwarding),
      sessionId: this.session.sessionId,
      instanceId: instance.InstanceId,
      instanceName: instance.Name,
      region: this.selectedSsmRegion,
      ...forwarding,
      autoStart: this.forwarding.autoStart,
    };
    this.appProviderService.repository.addSsmTunnel(tunnel);
    await tunnelService.start(tunnel.id);
    this.forwardingMessage = {
      text: `Tunnel "${tunnel.name}" is starting on localhost:${tunnel.localPort}. It runs in the background; follow it in Tunnels.`,
      error: false,
      showTunnels: true,
    };
  }

  /**
   * The old way: run the port forwarding in a terminal window, without saving it
   *
   * @param instanceId - the instance that forwards the traffic
   */
  async openInTerminal(instanceId: string): Promise<void> {
    const forwarding = this.validForwarding();
    if (!forwarding) {
      return;
    }
    const credentials = await (this.sessionService as AwsSessionService).generateCredentials(this.session.sessionId);
    this.ssmService.startPortForwardingSession(credentials, instanceId, this.selectedSsmRegion, forwarding);
    this.forwardingMessage = {
      text: `Opening a terminal: connect to localhost:${forwarding.localPort}. Stop the command there to close the tunnel.`,
      error: false,
    };
  }

  // A command to paste in any terminal; it uses the session's named profile
  copyCommand(instanceId: string, withForwarding: boolean): void {
    const forwarding = withForwarding ? this.validForwarding() : undefined;
    if (withForwarding && !forwarding) {
      return;
    }
    const profileName = this.appProviderService.namedProfileService.getProfileName((this.session as any).profileId);
    this.appService.copyToClipboard(ssmCommandForProfile(instanceId, this.selectedSsmRegion, profileName, forwarding));
    this.messageToasterService.toast("It uses the session's named profile, so start the session first.", ToastLevel.success, "Command Copied");
  }

  showTunnels(): void {
    this.closeModal();
    this.appProviderService.behaviouralSubjectService.unselectSessions();
    sidebarHighlight.next({ showAll: false, showPinned: false, selectedSegment: -1, showTunnels: true });
  }

  private validForwarding(): SsmPortForwarding | undefined {
    const forwarding = forwardingFrom(this.forwarding);
    const problem = validatePortForwarding(forwarding);
    if (problem) {
      this.forwardingMessage = { text: problem, error: true };
      return undefined;
    }
    return forwarding;
  }
}
