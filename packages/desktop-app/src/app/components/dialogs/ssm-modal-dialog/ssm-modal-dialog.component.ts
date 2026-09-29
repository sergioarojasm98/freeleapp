import { Component, Input, OnInit } from "@angular/core";
import { Session } from "@noovolari/leapp-core/models/session";
import { AppService } from "../../../services/app.service";
import { AppProviderService } from "../../../services/app-provider.service";
import { SessionFactory } from "@noovolari/leapp-core/services/session-factory";
import { AwsSessionService } from "@noovolari/leapp-core/services/session/aws/aws-session-service";
import { SsmPortForwarding, SsmService, validatePortForwarding } from "@noovolari/leapp-core/services/ssm-service";
import { LeappBaseError } from "@noovolari/leapp-core/errors/leapp-base-error";
import { LogLevel } from "@noovolari/leapp-core/services/log-service";
import { constants } from "@noovolari/leapp-core/models/constants";
import { withRecentRegions } from "../../../services/region-options";

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
  public forwarding = { remoteHost: "", remotePort: "", localPort: "" };
  public forwardingMessage: { text: string; error: boolean } | null = null;

  private sessionFactory: SessionFactory;
  private ssmService: SsmService;

  constructor(private appService: AppService, private appProviderService: AppProviderService) {}

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
   * Forward a local port to a port on the instance, or on a host the instance can reach, in a terminal window
   *
   * @param instanceId - the instance that forwards the traffic
   */
  async startPortForwarding(instanceId: string): Promise<void> {
    const remotePort = Number(this.forwarding.remotePort);
    const forwarding: SsmPortForwarding = {
      remoteHost: this.forwarding.remoteHost.trim() || undefined,
      remotePort,
      // An empty local port uses the same number as the remote one
      localPort: this.forwarding.localPort.trim() ? Number(this.forwarding.localPort) : remotePort,
    };
    const problem = validatePortForwarding(forwarding);
    if (problem) {
      this.forwardingMessage = { text: problem, error: true };
      return;
    }

    const instance = this.instances.find((i) => i.InstanceId === instanceId);
    instance.loading = true;
    try {
      const credentials = await (this.sessionService as AwsSessionService).generateCredentials(this.session.sessionId);
      this.ssmService.startPortForwardingSession(credentials, instanceId, this.selectedSsmRegion, forwarding);
      this.forwardingMessage = {
        text: `Opening a terminal: connect to localhost:${forwarding.localPort}. Stop the command there to close the tunnel.`,
        error: false,
      };
    } finally {
      setTimeout(() => (instance.loading = false), 4000);
    }
  }
}
