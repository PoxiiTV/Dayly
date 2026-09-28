import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../lib/errors.js";
import { originFromRequest } from "../lib/googleMail.js";
import {
  beginSpotifyOAuth,
  completeSpotifyOAuth,
  disconnectSpotifyUser,
  saveSpotifyPreference,
  spotifyAccessTokenForUser,
  spotifyStatus,
} from "../lib/spotifyConnection.js";

export const spotifyRouter = Router();
spotifyRouter.use(requireAuth);

spotifyRouter.get("/config", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await spotifyStatus(req.user!.id));
}));

spotifyRouter.post("/oauth/start", validate(z.object({ returnTo: z.string().max(500).optional() })), asyncHandler(async (req, res) => {
  const authorizeUrl = await beginSpotifyOAuth({
    userId: req.user!.id,
    sessionId: req.sessionId!,
    origin: originFromRequest(req),
    returnTo: req.body.returnTo,
  });
  res.json({ authorizeUrl });
}));

spotifyRouter.post("/oauth/complete", validate(z.object({ code: z.string().trim().min(8).max(2048), state: z.string().trim().min(16).max(500) })), asyncHandler(async (req, res) => {
  res.json(await completeSpotifyOAuth({ userId: req.user!.id, sessionId: req.sessionId!, code: req.body.code, state: req.body.state }));
}));

spotifyRouter.get("/access-token", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await spotifyAccessTokenForUser(req.user!.id));
}));

spotifyRouter.post("/access-token/refresh", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await spotifyAccessTokenForUser(req.user!.id, true));
}));

spotifyRouter.post("/disconnect", asyncHandler(async (req, res) => {
  await disconnectSpotifyUser(req.user!.id);
  res.json({ ok: true });
}));

spotifyRouter.patch("/preference", validate(z.object({ embed: z.object({ kind: z.enum(["track", "album", "artist", "playlist", "episode", "show"]), id: z.string().regex(/^[A-Za-z0-9]+$/).max(100) }).nullable() })), asyncHandler(async (req, res) => {
  const connection = await saveSpotifyPreference(req.user!.id, req.body.embed);
  res.json({ embed: connection.selectedEmbedKind && connection.selectedEmbedId ? { kind: connection.selectedEmbedKind, id: connection.selectedEmbedId } : null });
}));
