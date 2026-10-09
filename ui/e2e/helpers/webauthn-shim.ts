import type { BrowserContext, Page } from "@playwright/test";
import {
  emptyCeremonyStore,
  performWebAuthnCeremony,
  type CeremonyRequest,
  type CeremonyResult,
  type CeremonyStore,
} from "./webauthn-ceremony.js";

export type DeviceKeys = CeremonyStore;

export function emptyDeviceKeys(): DeviceKeys {
  return emptyCeremonyStore();
}

/** The person picked this credential in the browser sheet. `rawIdB64` is standard base64. */
export async function selectE2eWebAuthn(page: Page, rawIdB64: string): Promise<void> {
  await page.evaluate((id) => {
    const select = (window as Window & { tcE2eWebAuthnSelect?: (idB64: string) => void }).tcE2eWebAuthnSelect;
    if (!select) throw new Error("webauthn select missing");
    select(id);
  }, rawIdB64);
}

/**
 * One browser context is one phone: Face ID for platform ceremonies, and a security key
 * when the page asks for a cross-platform authenticator. The page calls navigator.credentials.
 * Must run before the first navigation on the context.
 */
export async function installE2eWebAuthn(context: BrowserContext, keys: DeviceKeys): Promise<void> {
  await context.exposeFunction("tcE2eWebAuthnPerform", (request: CeremonyRequest): CeremonyResult => {
    return performWebAuthnCeremony(keys, request);
  });

  await context.addInitScript(() => {
    const w = window as Window & {
      tcE2eWebAuthnPerform: (request: unknown) => Promise<{
        ok: boolean;
        name?: string;
        message?: string;
        op?: string;
        attachment?: string;
        rawIdB64?: string;
        authenticatorDataB64?: string;
        clientDataJSON?: string;
        signatureB64?: string;
        userHandleB64?: string;
        spkiB64?: string;
        attestationObjectB64?: string;
      }>;
      open: typeof window.open;
    };

    const bytesToB64 = (source: BufferSource): string => {
      const bytes =
        source instanceof ArrayBuffer
          ? new Uint8Array(source)
          : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      return btoa(binary);
    };

    const b64ToArrayBuffer = (b64: string): ArrayBuffer => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    };

    const credentialFrom = (result: {
      op?: string;
      attachment?: string;
      rawIdB64?: string;
      authenticatorDataB64?: string;
      clientDataJSON?: string;
      signatureB64?: string;
      userHandleB64?: string;
      spkiB64?: string;
      attestationObjectB64?: string;
    }) => {
      const raw = new Uint8Array(b64ToArrayBuffer(result.rawIdB64 || ""));
      const rawId = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      let idBinary = "";
      for (let i = 0; i < raw.length; i++) idBinary += String.fromCharCode(raw[i]!);
      const id = btoa(idBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const clientBytes = new TextEncoder().encode(result.clientDataJSON || "");
      const clientDataJSON = clientBytes.buffer.slice(
        clientBytes.byteOffset,
        clientBytes.byteOffset + clientBytes.byteLength
      );
      const authenticatorData = b64ToArrayBuffer(result.authenticatorDataB64 || "");
      const response =
        result.op === "create"
          ? {
              clientDataJSON,
              attestationObject: b64ToArrayBuffer(result.attestationObjectB64 || ""),
              getAuthenticatorData: () => authenticatorData,
              getPublicKey: () => b64ToArrayBuffer(result.spkiB64 || ""),
              getPublicKeyAlgorithm: () => -7,
              getTransports: () =>
                result.attachment === "cross-platform" ? ["usb", "nfc", "ble"] : ["internal", "hybrid"],
            }
          : {
              clientDataJSON,
              authenticatorData,
              signature: b64ToArrayBuffer(result.signatureB64 || ""),
              userHandle: result.userHandleB64 ? b64ToArrayBuffer(result.userHandleB64) : null,
            };
      return {
        type: "public-key",
        id,
        rawId,
        authenticatorAttachment: result.attachment,
        response,
        getClientExtensionResults: () => ({}),
      };
    };

    let armedSelection = "";
    const selectCredential = (idB64: string) => {
      armedSelection = idB64;
      window.dispatchEvent(new CustomEvent("tc-e2e-webauthn-select", { detail: idB64 }));
    };
    (window as Window & { tcE2eWebAuthnSelect?: (idB64: string) => void }).tcE2eWebAuthnSelect = selectCredential;

    const perform = async (request: unknown) => {
      let result: Awaited<ReturnType<typeof w.tcE2eWebAuthnPerform>>;
      try {
        result = await w.tcE2eWebAuthnPerform(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The operation was not allowed.";
        throw new DOMException(message, "NotAllowedError");
      }
      if (!result?.ok) {
        throw new DOMException(result?.message || "The operation was not allowed.", result?.name || "NotAllowedError");
      }
      return credentialFrom(result);
    };

    const readRequest = (options: CredentialRequestOptions | CredentialCreationOptions | undefined, op: "create" | "get") => {
      const publicKey = options && "publicKey" in options ? options.publicKey : undefined;
      if (!publicKey) throw new DOMException("Only public-key credentials are simulated.", "NotSupportedError");
      if (op === "create") {
        const creation = publicKey as PublicKeyCredentialCreationOptions;
        return {
          op,
          origin: window.location.origin,
          hostname: window.location.hostname,
          rpId: creation.rp?.id || window.location.hostname,
          challengeB64: bytesToB64(creation.challenge),
          attachment: creation.authenticatorSelection?.authenticatorAttachment || "",
          userVerification: creation.authenticatorSelection?.userVerification || "",
          residentKey: creation.authenticatorSelection?.residentKey || "",
          requireResidentKey: Boolean(creation.authenticatorSelection?.requireResidentKey),
          hints: creation.hints || [],
          params: (creation.pubKeyCredParams || []).map((param) => ({ alg: param.alg, type: param.type })),
          userHandleB64: creation.user?.id ? bytesToB64(creation.user.id) : "",
          exclude: (creation.excludeCredentials || []).map((descriptor) => ({ idB64: bytesToB64(descriptor.id) })),
        };
      }
      const request = publicKey as PublicKeyCredentialRequestOptions;
      return {
        op,
        origin: window.location.origin,
        hostname: window.location.hostname,
        rpId: request.rpId || window.location.hostname,
        challengeB64: bytesToB64(request.challenge),
        userVerification: request.userVerification || "",
        hints: request.hints || [],
        allow: (request.allowCredentials || []).map((descriptor) => ({
          idB64: bytesToB64(descriptor.id),
          transports: descriptor.transports || [],
        })),
      };
    };

    const create = async (options?: CredentialCreationOptions) => {
      if (options?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return perform(readRequest(options, "create"));
    };
    const waitForSelection = (signal: AbortSignal | undefined): Promise<string> =>
      new Promise((resolve, reject) => {
        const abort = () => {
          cleanup();
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        const onSelect = (event: Event) => {
          const id = (event as CustomEvent<string>).detail;
          cleanup();
          resolve(id);
        };
        const cleanup = () => {
          signal?.removeEventListener("abort", abort);
          window.removeEventListener("tc-e2e-webauthn-select", onSelect);
        };
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort);
        window.addEventListener("tc-e2e-webauthn-select", onSelect);
      });

    const get = async (options?: CredentialRequestOptions & { mediation?: string }) => {
      if (options?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const request = readRequest(options, "get") as { selectedIdB64?: string };
      if (options?.mediation === "conditional") {
        // Autofill does not sign until the person picks a passkey, even when only one exists.
        request.selectedIdB64 = await waitForSelection(options.signal);
        armedSelection = "";
        return perform(request);
      }
      if (armedSelection) {
        request.selectedIdB64 = armedSelection;
        armedSelection = "";
      }
      return perform(request);
    };

    const credentialsCtor = (globalThis as { CredentialsContainer?: { prototype: CredentialsContainer } }).CredentialsContainer;
    const installOn = (host: { create?: unknown; get?: unknown } | null | undefined) => {
      if (!host) return;
      try {
        Object.defineProperty(host, "create", { configurable: true, writable: true, value: create });
        Object.defineProperty(host, "get", { configurable: true, writable: true, value: get });
      } catch {
        try {
          host.create = create;
          host.get = get;
        } catch {
          /* the page has no overridable credentials container */
        }
      }
    };
    installOn(credentialsCtor?.prototype);
    installOn(navigator.credentials);
    if (window.PublicKeyCredential) {
      Object.defineProperty(PublicKeyCredential, "isUserVerifyingPlatformAuthenticatorAvailable", {
        configurable: true,
        value: () => Promise.resolve(true),
      });
    }

    const nativeOpen = w.open.bind(w);
    w.open = (url?: string | URL, target?: string, features?: string) => {
      if (typeof url === "string" && url.includes("/pay")) {
        window.location.assign(url);
        return null;
      }
      return nativeOpen(url, target, features);
    };
  });
}
