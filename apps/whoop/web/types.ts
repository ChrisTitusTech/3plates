import type { Day, Detail } from "../server/domain";
export type Summary = Record<string, { value: number | null; count: number }>;
export type Dashboard = {
  contextVersion?: string;
  completeness?: ReturnType<typeof import("../server/history").completeness>;
  exploration: Day[];
  lifetime: ReturnType<typeof import("../server/analytics").lifetimeStats>;
  analytics: ReturnType<typeof import("../server/analytics").analyticsPayload>;
  name: string;
  start: string;
  end: string;
  earliest: string | null;
  latest: string | null;
  lastSync: string | null;
  summary: Summary;
  previous: Summary;
  previousStart: string;
  previousEnd: string;
  days: Day[];
  chart: { mode: string; points: Record<string, any>[] };
  details: Detail[];
  body: Detail | null;
};
export type Member = {
  name: string;
  connected: boolean;
  shareUrl: string | null;
  sharePolicy?: import("../server/history").SharePolicy | null;
};
export type Sync = {
  connected: boolean;
  lastSync: string | null;
  lastSuccessful?: { kind: string; at: string }[];
  jobs: {
    kind: string;
    status: string;
    count: number;
    error: string | null;
    mode: string | null;
  }[];
};
