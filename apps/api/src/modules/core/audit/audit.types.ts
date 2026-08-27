export type AuditEvent = {
  action: string;
  actorUserId: string | null;
  // One row per member the event touches; each member's rows are also their feed.
  subjectUserIds: string[];
  familyId?: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
};
