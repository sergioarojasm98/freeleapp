import { copiedCommandMessage, defaultTunnelName, emptyTunnelDraft, forwardingFrom, tunnelDraftFrom } from "./tunnel-draft";

describe("tunnel-draft", () => {
  it("forwardingFrom trims the host and uses the remote port when the local one is empty", () => {
    const draft = { ...emptyTunnelDraft(), remoteHost: "  ", remotePort: "5432", localPort: " " };
    expect(forwardingFrom(draft)).toEqual({ remoteHost: undefined, remotePort: 5432, localPort: 5432 });

    const withHost = { ...emptyTunnelDraft(), remoteHost: " db.internal ", remotePort: "5432", localPort: "15454" };
    expect(forwardingFrom(withHost)).toEqual({ remoteHost: "db.internal", remotePort: 5432, localPort: 15454 });
  });

  it("defaultTunnelName uses the instance, or the first label of the remote host", () => {
    expect(defaultTunnelName("rabbitmq-prod-1", { remotePort: 15672, localPort: 17007 })).toBe("rabbitmq-prod-1:15672");
    expect(
      defaultTunnelName("bastion", { remoteHost: "batchengine-psql.clykg60eg5sn.us-west-2.rds.amazonaws.com", remotePort: 5432, localPort: 15454 })
    ).toBe("batchengine-psql:5432");
  });

  it("tunnelDraftFrom turns a saved tunnel back into form values", () => {
    const tunnel = {
      id: "t1",
      name: "db",
      sessionId: "s1",
      instanceId: "i-1",
      instanceName: "bastion",
      region: "us-west-2",
      remotePort: 5432,
      localPort: 15454,
      autoStart: true,
    };
    expect(tunnelDraftFrom(tunnel)).toEqual({ name: "db", remoteHost: "", remotePort: "5432", localPort: "15454", autoStart: true });
  });

  it("copiedCommandMessage says whether the profile can be used right now", () => {
    expect(copiedCommandMessage("cogs-jo-prd", true)).toBe('Command copied. It uses the "cogs-jo-prd" profile, so paste it in any terminal.');
    expect(copiedCommandMessage("cogs-jo-prd", false)).toContain("start the session before running it");
  });
});
