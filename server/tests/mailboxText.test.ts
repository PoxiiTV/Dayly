import { describe, expect, it } from "vitest";
import {
  buildReplySubject,
  htmlToText,
  imapErrorMessage,
  quotePlain,
  snippetOf,
} from "../src/lib/mailboxText.js";

describe("mailbox text helpers", () => {
  it("strips html to readable text", () => {
    expect(htmlToText("<p>Hola <b>Alexis</b></p><script>alert(1)</script><br>resto")).toContain("Hola");
    expect(htmlToText("<p>Hola</p>")).not.toMatch(/<|>|script/i);
  });

  it("quotes a reply and prefixes Re:", () => {
    expect(quotePlain("línea 1\nlínea 2")).toBe("> línea 1\n> línea 2");
    expect(buildReplySubject("Factura")).toBe("Re: Factura");
    expect(buildReplySubject("Re: Factura")).toBe("Re: Factura");
  });

  it("clips snippets and maps IMAP errors without leaking details", () => {
    expect(snippetOf("una frase corta")).toBe("una frase corta");
    expect(snippetOf("x".repeat(200)).endsWith("…")).toBe(true);
    expect(imapErrorMessage(new Error("Invalid credentials"))).toMatch(/contraseña de aplicación/i);
    expect(imapErrorMessage(new Error("ENOTFOUND imap.example.com"))).not.toContain("imap.example.com");

    const imapFlowAuth = Object.assign(new Error("Command failed"), {
      authenticationFailed: true,
      responseText: "LOGIN failed",
      serverResponseCode: "AUTHENTICATIONFAILED",
      code: "EAUTH",
    });
    expect(imapErrorMessage(imapFlowAuth)).toMatch(/contraseña de aplicación/i);
    expect(imapErrorMessage(imapFlowAuth, "imap.zoho.eu")).toMatch(/Authy/i);
    expect(imapErrorMessage(imapFlowAuth, "imap.zoho.eu")).toMatch(/contraseña de aplicación/i);

    const wrongHost = Object.assign(new Error("Command failed"), {
      authenticationFailed: true,
      responseText: "The server details you are using seems incorrect. For more details, check this announcement: https://help.zoho.com/portal/en/community/topic/zoho-mail-server-details",
      serverResponseCode: "ALERT",
    });
    expect(imapErrorMessage(wrongHost, "imappro.zoho.eu")).toMatch(/imap\.zoho\.eu/i);
    expect(imapErrorMessage(wrongHost, "imappro.zoho.eu")).not.toMatch(/imappro\.zoho\.eu \(no imap/i);

    const imapOff = Object.assign(new Error("Command failed"), {
      authenticationFailed: true,
      responseText: "You are yet to enable IMAP for your account. Please contact your administrator (Failure)",
      serverResponseCode: "ALERT",
    });
    expect(imapErrorMessage(imapOff, "imap.zoho.eu")).toMatch(/IMAP no está disponible/i);
    expect(imapErrorMessage(imapOff, "imap.zoho.eu")).toMatch(/plan de pago|gratuito/i);
    expect(imapErrorMessage(new Error("IMAP access is not enabled for this account"), "imap.zoho.eu")).toMatch(/IMAP no está disponible/i);
  });
});
