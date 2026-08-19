import { describe, it, expect } from "vitest";
import {
  emptyBundle,
  serializeJson,
  parseJson,
  serializeCsv,
  parseCsv,
  serializeIcs,
  parseIcs,
  detectFormat,
  parseTransfer,
  serializeTransfer,
  MAX_TRANSFER_CHARS,
} from "../src/lib/transfer.js";

const sample = (): ReturnType<typeof emptyBundle> => ({
  version: 1,
  exportedAt: "2026-08-18T10:00:00.000Z",
  tasks: [
    {
      title: "Cerrar sprint",
      description: "Revisar PRs",
      dueDate: "2026-08-20T17:00:00.000Z",
      hasTime: true,
      priority: "HIGH",
      status: "PENDING",
    },
  ],
  events: [
    {
      title: "Reunión cliente",
      description: "Demo",
      startAt: "2026-08-19T09:00:00.000Z",
      endAt: "2026-08-19T10:00:00.000Z",
      allDay: false,
      location: "Madrid",
    },
  ],
  notes: [{ title: "Ideas", content: "Línea 1\nLínea 2", pinned: true }],
});

describe("JSON transfer", () => {
  it("roundtrips tasks, events and notes without userId", () => {
    const json = serializeJson(sample());
    expect(json).not.toContain("userId");
    const parsed = parseJson(json);
    expect(parsed.tasks[0].title).toBe("Cerrar sprint");
    expect(parsed.events[0].location).toBe("Madrid");
    expect(parsed.notes[0].content).toContain("Línea 2");
    expect(parsed.version).toBe(1);
  });

  it("rejects json that is not a Dayly bundle", () => {
    expect(() => parseJson("{}")).toThrow();
    expect(() => parseJson('{"version":1}')).toThrow();
  });

  it("strips foreign ids and userId on parse", () => {
    const parsed = parseJson(
      JSON.stringify({
        version: 1,
        tasks: [{ title: "X", userId: "otro", id: "cuid_ajeno" }],
        events: [],
        notes: [],
      }),
    );
    expect(parsed.tasks[0].title).toBe("X");
    expect(JSON.stringify(parsed)).not.toContain("otro");
    expect(JSON.stringify(parsed)).not.toContain("cuid_ajeno");
  });
});

describe("CSV transfer", () => {
  it("roundtrips with quoted commas and newlines", () => {
    const bundle = emptyBundle("2026-01-01T00:00:00.000Z");
    bundle.tasks.push({ title: "Comprar pan, leche", description: "a,b" });
    bundle.notes.push({ title: "Nota", content: "uno\ndos" });
    const csv = serializeCsv(bundle);
    expect(csv.split("\n")[0]).toMatch(/kind,/);
    const parsed = parseCsv(csv);
    expect(parsed.tasks[0].title).toBe("Comprar pan, leche");
    expect(parsed.notes[0].content).toBe("uno\ndos");
  });
});

describe("ICS transfer", () => {
  it("exports VEVENT, VTODO and VJOURNAL", () => {
    const ics = serializeIcs(sample());
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toContain("BEGIN:VJOURNAL");
    expect(ics).toContain("SUMMARY:Reunión cliente");
    expect(ics).toContain("SUMMARY:Cerrar sprint");
    expect(ics).toContain("SUMMARY:Ideas");
  });

  it("parses a standard calendar into events and tasks", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "SUMMARY:Standup",
      "DTSTART:20260819T080000Z",
      "DTEND:20260819T081500Z",
      "LOCATION:Sala 2",
      "END:VEVENT",
      "BEGIN:VTODO",
      "SUMMARY:Enviar factura",
      "DUE:20260821T170000Z",
      "STATUS:NEEDS-ACTION",
      "END:VTODO",
      "BEGIN:VJOURNAL",
      "SUMMARY:Diario",
      "DESCRIPTION:Hoy fue bien",
      "END:VJOURNAL",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(ics);
    expect(parsed.events[0].title).toBe("Standup");
    expect(parsed.events[0].location).toBe("Sala 2");
    expect(parsed.tasks[0].title).toBe("Enviar factura");
    expect(parsed.notes[0].title).toBe("Diario");
    expect(parsed.notes[0].content).toBe("Hoy fue bien");
  });

  it("unescapes DESCRIPTION commas and newlines", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:A",
      "DTSTART:20260819T090000Z",
      "DTEND:20260819T100000Z",
      "DESCRIPTION:Hola\\nMundo\\, sigue",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcs(ics).events[0].description).toBe("Hola\nMundo, sigue");
  });
});

describe("detect + parseTransfer", () => {
  it("detects json, ics and csv", () => {
    expect(detectFormat('{"version":1,"tasks":[],"events":[],"notes":[]}')).toBe("json");
    expect(detectFormat("BEGIN:VCALENDAR\nEND:VCALENDAR")).toBe("ics");
    expect(detectFormat("kind,title\ntask,Hola")).toBe("csv");
  });

  it("serializeTransfer then parseTransfer roundtrips json", () => {
    const again = parseTransfer(serializeTransfer(sample(), "json"), "json");
    expect(again.tasks).toHaveLength(1);
    expect(again.events).toHaveLength(1);
    expect(again.notes).toHaveLength(1);
  });

  it("rejects empty or oversized payloads", () => {
    expect(() => parseTransfer("   ")).toThrow();
    expect(() => parseTransfer("x".repeat(MAX_TRANSFER_CHARS + 1))).toThrow();
  });
});
