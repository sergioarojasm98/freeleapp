import { AppKeychainService } from "./app-keychain-service";
import { constants } from "@noovolari/leapp-core/models/constants";

describe("AppKeychainService", () => {
  let store: Map<string, string>;
  let service: AppKeychainService;
  const key = (s: string, a: string) => `${s}/${a}`;

  beforeEach(() => {
    store = new Map();
    const keytar = {
      getPassword: async (s: string, a: string) => store.get(key(s, a)) ?? null,
      setPassword: async (s: string, a: string, p: string) => void store.set(key(s, a), p),
      deletePassword: async (s: string, a: string) => store.delete(key(s, a)),
    };
    service = new AppKeychainService({ keytar } as any);
  });

  it("reads Freeleapp secrets directly", async () => {
    store.set(key(constants.appName, "token"), "new");
    store.set(key(constants.legacyAppName, "token"), "old");

    expect(await service.getSecret(constants.appName, "token")).toBe("new");
  });

  it("copies a Leapp secret to Freeleapp the first time it is read", async () => {
    store.set(key(constants.legacyAppName, "token"), "from-leapp");

    expect(await service.getSecret(constants.appName, "token")).toBe("from-leapp");
    expect(store.get(key(constants.appName, "token"))).toBe("from-leapp");
  });

  it("returns null when neither service has the secret", async () => {
    expect(await service.getSecret(constants.appName, "missing")).toBeNull();
  });

  it("deletes the Leapp copy too, so a deleted secret does not come back", async () => {
    store.set(key(constants.appName, "token"), "new");
    store.set(key(constants.legacyAppName, "token"), "old");

    expect(await service.deleteSecret(constants.appName, "token")).toBeTrue();
    expect(await service.getSecret(constants.appName, "token")).toBeNull();
  });
});
