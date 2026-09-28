import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, ApiError } from "../lib/errors.js";
import { authLimiter, quickPinLimiter, sensitiveLimiter } from "../middleware/rateLimit.js";
import { allowPublicRegistration } from "../config/env.js";
import * as schemas from "../validation/schemas.js";
import {
  register,
  login,
  logout,
  changePassword,
  listSessions,
  revokeSession,
  revokeAllOtherSessions,
  start2faSetup,
  enable2fa,
  disable2fa,
  regenerateRecoveryCodes,
  forgotPassword,
  resetPassword,
  verifyEmail,
  firstPassword,
  verifyQuickPin,
  setQuickPin,
  toggleQuickPin,
  deleteQuickPin,
} from "../services/account.service.js";

export const authRouter = Router();

const resendSchema = z.object({ email: z.string().trim().toLowerCase().email("Email no válido") });

/** GET /api/auth/public-config — no secrets; used by the login page. */
authRouter.get("/public-config", (_req, res) => {
  res.json({ allowPublicRegistration: allowPublicRegistration() });
});

/** POST /api/auth/register */
authRouter.post(
  "/register",
  authLimiter,
  validate(schemas.registerSchema),
  asyncHandler(async (req, res) => {
    if (!allowPublicRegistration()) {
      throw ApiError.forbidden("El registro público está desactivado.");
    }
    const data = await register(req, req.body as { name: string; email: string; password: string });
    res.status(201).json(data);
  }),
);

/** POST /api/auth/login */
authRouter.post(
  "/login",
  authLimiter,
  validate(schemas.loginSchema),
  asyncHandler(async (req, res) => {
    const data = await login(req, req.body as { email: string; password: string; twoFactorCode?: string });
    res.json(data);
  }),
);

/** POST /api/auth/logout */
authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await logout(req);
    res.json({ ok: true });
  }),
);

/** GET /api/auth/me — current authenticated user */
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { toPublicUser } = await import("../services/auth.service.js");
    const { prisma } = await import("../lib/prisma.js");
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      include: { role: true },
    });
    res.json({ user: toPublicUser(user), sessionId: req.sessionId });
  }),
);

/** POST /api/auth/verify-email/request (signed link sent via SMTP; dev logs it) */
authRouter.post(
  "/verify-email/request",
  authLimiter,
  validate(resendSchema),
  asyncHandler(async (req, res) => {
    const { makeVerifyToken, sendVerifyEmail, verifyUrl } = await import("../lib/mail.js");
    const { prisma } = await import("../lib/prisma.js");
    const email = (req.body as { email: string }).email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { emailLower: email } });
    if (user && !user.emailVerifiedAt) {
      const token = makeVerifyToken(email);
      await sendVerifyEmail(user.email, user.name, verifyUrl(token));
    }
    res.json({ ok: true });
  }),
);

/** GET /api/auth/verify-email?token=... */
authRouter.get(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const token = (req.query.token as string) ?? "";
    const data = await verifyEmail(req, token);
    res.json(data);
  }),
);

/** POST /api/auth/forgot-password */
authRouter.post(
  "/forgot-password",
  sensitiveLimiter,
  validate(schemas.forgotSchema),
  asyncHandler(async (req, res) => {
    const data = await forgotPassword(req, (req.body as { email: string }).email);
    res.json(data);
  }),
);

/** POST /api/auth/reset-password */
authRouter.post(
  "/reset-password",
  authLimiter,
  validate(schemas.resetSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as { token: string; password: string };
    const data = await resetPassword(req, token, password);
    res.json(data);
  }),
);

// ---------- Authenticated account management ----------
/** POST /api/auth/quick-pin/verify — unlock the app UI. */
authRouter.post(
  "/quick-pin/verify",
  requireAuth,
  quickPinLimiter,
  validate(schemas.quickPinVerifySchema),
  asyncHandler(async (req, res) => {
    res.json(await verifyQuickPin(req, (req.body as { pin: string }).pin));
  }),
);

/** POST /api/auth/quick-pin — create or change the app PIN. */
authRouter.post(
  "/quick-pin",
  requireAuth,
  authLimiter,
  validate(schemas.quickPinSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { pin: string; currentPin?: string };
    res.json(await setQuickPin(req, body.pin, body.currentPin));
  }),
);

/** PATCH /api/auth/quick-pin — enable/disable without deleting the PIN. */
authRouter.patch(
  "/quick-pin",
  requireAuth,
  authLimiter,
  validate(schemas.quickPinToggleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { enabled: boolean; currentPin?: string };
    res.json(await toggleQuickPin(req, body.enabled, body.currentPin));
  }),
);

/** DELETE /api/auth/quick-pin — remove the configured PIN. */
authRouter.delete(
  "/quick-pin",
  requireAuth,
  authLimiter,
  validate(z.object({ currentPin: z.string().max(32).optional() }).strict()),
  asyncHandler(async (req, res) => {
    res.json(await deleteQuickPin(req, (req.body as { currentPin?: string }).currentPin));
  }),
);

/** GET /api/auth/sessions */
authRouter.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ sessions: await listSessions(req) });
  }),
);

/** DELETE /api/auth/sessions/:id */
authRouter.delete(
  "/sessions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await revokeSession(req, req.params.id));
  }),
);

/** POST /api/auth/sessions/revoke-all */
authRouter.post(
  "/sessions/revoke-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await revokeAllOtherSessions(req));
  }),
);

/** POST /api/auth/change-password */
authRouter.post(
  "/change-password",
  requireAuth,
  authLimiter,
  validate(schemas.changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    res.json(await changePassword(req, { currentPassword, newPassword }));
  }),
);

/** POST /api/auth/first-password — mandatory after admin invite. */
authRouter.post(
  "/first-password",
  requireAuth,
  authLimiter,
  validate(schemas.firstPasswordSchema),
  asyncHandler(async (req, res) => {
    const { password } = req.body as { password: string };
    res.json(await firstPassword(req, password));
  }),
);

/** POST /api/auth/2fa/setup -> { secret, url } */
authRouter.post(
  "/2fa/setup",
  requireAuth,
  authLimiter,
  validate(schemas.setup2faSchema),
  asyncHandler(async (req, res) => {
    res.json(await start2faSetup(req, req.body as { currentPassword?: string; code?: string }));
  }),
);

/** POST /api/auth/2fa/enable -> verify code + return recovery codes */
authRouter.post(
  "/2fa/enable",
  requireAuth,
  authLimiter,
  validate(schemas.enable2faSchema),
  asyncHandler(async (req, res) => {
    res.json(await enable2fa(req, (req.body as { code: string }).code));
  }),
);

/** POST /api/auth/2fa/disable */
authRouter.post(
  "/2fa/disable",
  requireAuth,
  authLimiter,
  validate(schemas.enable2faSchema),
  asyncHandler(async (req, res) => {
    res.json(await disable2fa(req, (req.body as { code: string }).code));
  }),
);

/** POST /api/auth/2fa/recovery-codes — TOTP + new recovery codes (old ones die) */
authRouter.post(
  "/2fa/recovery-codes",
  requireAuth,
  authLimiter,
  validate(schemas.enable2faSchema),
  asyncHandler(async (req, res) => {
    res.json(await regenerateRecoveryCodes(req, (req.body as { code: string }).code));
  }),
);

authRouter.get(
  "/passkeys",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { listPasskeys } = await import("../lib/passkeys.js");
    res.json({ passkeys: await listPasskeys(req.user!.id) });
  }),
);

authRouter.post(
  "/passkeys/register/options",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { startRegister } = await import("../lib/passkeys.js");
    res.json(await startRegister(req));
  }),
);

authRouter.post(
  "/passkeys/register",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { finishRegister } = await import("../lib/passkeys.js");
    res.status(201).json(await finishRegister(req, req.body as { challengeId?: string; name?: string; response?: never }));
  }),
);

authRouter.post(
  "/passkeys/login/options",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { startLogin } = await import("../lib/passkeys.js");
    res.json(await startLogin(req));
  }),
);

authRouter.post(
  "/passkeys/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { finishLogin } = await import("../lib/passkeys.js");
    res.json(await finishLogin(req, req.body as { challengeId?: string; response?: never }));
  }),
);

authRouter.delete(
  "/passkeys/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { deletePasskey } = await import("../lib/passkeys.js");
    await deletePasskey(req.user!.id, req.params.id);
    res.json({ ok: true });
  }),
);

export default authRouter;
