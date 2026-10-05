/**
 * A funnel is a directed graph. Nodes are stages a lead can sit in; edges are the moves out of a stage.
 * Levels are not written by hand: they are BFS depth from `entry`, so adding a stage re-levels the graph.
 */

export type NodeKind = "stage" | "nurture" | "won" | "lost";

/** advance: the stage's goal was met. timeout: no reply after `after_days`. disqualify: moved to nurture or lost. */
export type EdgeKind = "advance" | "timeout" | "disqualify" | "reengage";

export interface Segment {
  id: string;
  label: string;
  /** Lead fields that put a lead in this segment. A lead takes the first segment whose rules all hold. */
  match: Record<string, string[]>;
}

export interface Message {
  id: string;
  label: string;
  /** Segments this wording is for. Absent = every segment that reaches the node. */
  segments?: string[];
  text: string;
}

export interface Edge {
  id: string;
  to: string;
  kind: EdgeKind;
  /** The signal that fires the edge, in plain words. */
  when: string;
  after_days?: number;
  /** Segments that may take this edge. Absent = all. */
  segments?: string[];
}

export interface Node {
  id: string;
  label: string;
  kind: NodeKind;
  goal: string;
  /** What the lead gets at this stage, what it costs them, what we learn. The value-ladder row. */
  value?: string;
  ask?: string;
  learn?: string;
  /** Segments that can sit in this node. Absent = all. */
  segments?: string[];
  messages: Message[];
  exits: Edge[];
  /** Claims the copy at this stage must not make. */
  do_not_claim?: string[];
}

export type ObjectionStatus = "observed" | "hypothesis";

export interface Objection {
  id: string;
  label: string;
  /** Nodes where this objection comes up. */
  at: string[];
  /** Lowercase phrases that suggest a reply is this objection. Used by `classify`, never applied automatically. */
  signals: string[];
  status: ObjectionStatus;
  /** What it usually means about the lead. */
  reading: string;
  response: string;
  /** Where the lead goes after the response. */
  to: string;
  /** Per-segment override of `to`, for segments the default target is closed to. */
  to_by_segment?: Record<string, string>;
  /** A new lead to open, e.g. the person they referred you to, and the node they start at. */
  spawn?: { node: string; note: string };
}

export interface FunnelGraph {
  id: string;
  name: string;
  side: "demand" | "supply";
  version: string;
  entry: string;
  segments: Segment[];
  nodes: Node[];
  objections: Objection[];
  import?: ImportSpec;
}

/** How an existing outreach list and its tracker map onto the graph. */
export interface ImportSpec {
  /** Company fields copied onto each lead (and usable as {field} in templates). */
  lead_fields: string[];
  /** Template fields computed from a company field through a lookup. */
  derive?: Record<string, { from: string; map: Record<string, string> }>;
  /** Tracker status -> edge out of the entry node. */
  status?: Record<string, string>;
  /** Tracker stage -> node, or segment -> node. */
  stage?: Record<string, string | Record<string, string>>;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  title?: string;
  segment: string;
  fields?: Record<string, string>;
}

export type EventVia = { edge: string } | { objection: string } | { import: string } | { set: true };

/** One move of one lead. The log is append-only; a lead's current node is the `to` of its last event. */
export interface TraceEvent {
  id: number;
  lead: string;
  at: string;
  from: string | null;
  to: string;
  via: EventVia;
  message?: string;
  reply?: string;
  note?: string;
}

export interface Level {
  depth: number;
  nodes: string[];
}

export interface Issue {
  level: "error" | "warn";
  where: string;
  msg: string;
}
