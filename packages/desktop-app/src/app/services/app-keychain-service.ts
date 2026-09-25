import { IKeychainService } from "@noovolari/leapp-core/interfaces/i-keychain-service";
import { INativeService } from "@noovolari/leapp-core/interfaces/i-native-service";
import { constants } from "@noovolari/leapp-core/models/constants";

export class AppKeychainService implements IKeychainService {
  constructor(private nativeService: INativeService) {}

  /**
   * Save your secret in the keychain
   *
   * @param service - environment.appName
   * @param account - unique identifier
   * @param password - secret - not null
   */
  async saveSecret(service: string, account: string, password: string): Promise<void> {
    return await this.nativeService.keytar.setPassword(service, account, password ?? "<EMPTY>");
  }

  /**
   * Retrieve a Secret from the keychain
   *
   * @param service - environment.appName
   * @param account - unique identifier
   * @returns the secret
   */
  async getSecret(service: string, account: string): Promise<string | null> {
    const secret = await this.nativeService.keytar.getPassword(service, account);
    if (secret !== null || service !== constants.appName) {
      return secret;
    }
    // Leapp stored secrets under its own service name: copy each one the first time it is needed,
    // so macOS only asks for access to the items that are actually used
    const legacySecret = await this.nativeService.keytar.getPassword(constants.legacyAppName, account);
    if (legacySecret !== null) {
      await this.nativeService.keytar.setPassword(service, account, legacySecret);
    }
    return legacySecret;
  }

  /**
   * Delete a secret from the keychain
   *
   * @param service - environment.appName
   * @param account - unique identifier
   */
  async deleteSecret(service: string, account: string): Promise<boolean> {
    const deleted = await this.nativeService.keytar.deletePassword(service, account);
    if (service !== constants.appName) {
      return deleted;
    }
    // Otherwise getSecret would bring the old Leapp copy back (e.g. an expired token after logout)
    const legacyDeleted = await this.nativeService.keytar.deletePassword(constants.legacyAppName, account);
    return deleted || legacyDeleted;
  }
}
