import { pgTable, uuid, text, timestamp, pgEnum, time, boolean, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('guardian_role', ['primary', 'co'])
export const notifyViaEnum = pgEnum('notify_via', ['imessage', 'gmail'])
export const sentimentEnum = pgEnum('sentiment', ['positive', 'neutral', 'alert'])
export const activityTypeEnum = pgEnum('activity_type', ['call', 'message'])
export const directionEnum = pgEnum('direction', ['inbound', 'outbound'])
export const summaryFreqEnum = pgEnum('summary_freq', ['weekly', 'monthly'])
export const subPlanEnum = pgEnum('sub_plan', ['basic', 'family'])
export const subCycleEnum = pgEnum('sub_cycle', ['monthly', 'yearly'])
export const subStatusEnum = pgEnum('sub_status', ['trialing', 'active', 'past_due', 'cancelled', 'expired'])

// ─── Tables ───────────────────────────────────────────────────────────────────

// Mirrors Supabase auth.users — we create a row here on first sign-in
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // same UUID as auth.users
  email: text('email').notNull().unique(),
  phone: text('phone'), // for iMessage alerts to this guardian
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const parents = pgTable('parents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  timezone: text('timezone').notNull().default('America/New_York'),
  activeHoursFrom: time('active_hours_from').notNull().default('09:00'),
  activeHoursTo: time('active_hours_to').notNull().default('20:00'),
  isActive: boolean('is_active').notNull().default(true),
  // Guardian-initiated pause: Mae (COMPANION_NAME) stops initiating (still replies) until this passes
  pausedUntil: timestamp('paused_until'),
  pausedAt: timestamp('paused_at'),
  pauseReminderSentAt: timestamp('pause_reminder_sent_at'),
  // Set once guardians have been alerted about an unanswered-message streak
  noReplyAlertedAt: timestamp('no_reply_alerted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const guardianParentLinks = pgTable('guardian_parent_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  guardianId: uuid('guardian_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('primary'),
  notifyVia: notifyViaEnum('notify_via').notNull().default('imessage'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  type: activityTypeEnum('type').notNull(),
  direction: directionEnum('direction').notNull().default('inbound'),
  summary: text('summary').notNull(),
  sentiment: sentimentEnum('sentiment').notNull().default('neutral'),
  rawTranscript: text('raw_transcript'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const companionFacts = pgTable('companion_facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const summarySchedules = pgTable('summary_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }).unique(),
  frequency: summaryFreqEnum('frequency').notNull().default('weekly'),
  // weekly: 0=Mon … 6=Sun
  dayOfWeek: integer('day_of_week'),
  // monthly: 1-28, or null for "last day"
  dayOfMonth: integer('day_of_month'),
  sendAt: time('send_at').notNull().default('18:00'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Agent-scheduled follow-ups: the agent decides to check back on something later
// (e.g. "ask how the doctor's appointment went at 5pm"); heartbeat executes them
export const scheduledActions = pgTable('scheduled_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  dueAt: timestamp('due_at').notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// One subscription per parent ("one companion, one person" pricing). Created
// with parentId=null right after checkout, then linked to the
// parent the guardian creates next in the Setup wizard.
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  guardianId: uuid('guardian_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references(() => parents.id, { onDelete: 'set null' }).unique(),
  plan: subPlanEnum('plan').notNull(),
  cycle: subCycleEnum('cycle').notNull(),
  status: subStatusEnum('status').notNull().default('trialing'),
  paddleSubscriptionId: text('paddle_subscription_id').unique(),
  paddleCustomerId: text('paddle_customer_id'),
  trialEndsAt: timestamp('trial_ends_at'),
  renewsAt: timestamp('renews_at'),
  endsAt: timestamp('ends_at'), // set when cancelled — stays active until this date
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  notifyVia: notifyViaEnum('notify_via').notNull().default('imessage'),
  token: text('token').notNull().unique(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  guardianLinks: many(guardianParentLinks),
  sentInvites: many(invites),
  subscriptions: many(subscriptions),
}))

export const parentsRelations = relations(parents, ({ many, one }) => ({
  guardianLinks: many(guardianParentLinks),
  activityLogs: many(activityLogs),
  companionFacts: many(companionFacts),
  reminders: many(reminders),
  summarySchedule: many(summarySchedules),
  invites: many(invites),
  scheduledActions: many(scheduledActions),
  subscription: one(subscriptions, { fields: [parents.id], references: [subscriptions.parentId] }),
}))

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  guardian: one(users, { fields: [subscriptions.guardianId], references: [users.id] }),
  parent: one(parents, { fields: [subscriptions.parentId], references: [parents.id] }),
}))

export const scheduledActionsRelations = relations(scheduledActions, ({ one }) => ({
  parent: one(parents, { fields: [scheduledActions.parentId], references: [parents.id] }),
}))

export const guardianParentLinksRelations = relations(guardianParentLinks, ({ one }) => ({
  guardian: one(users, { fields: [guardianParentLinks.guardianId], references: [users.id] }),
  parent: one(parents, { fields: [guardianParentLinks.parentId], references: [parents.id] }),
}))

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  parent: one(parents, { fields: [activityLogs.parentId], references: [parents.id] }),
}))

export const companionFactsRelations = relations(companionFacts, ({ one }) => ({
  parent: one(parents, { fields: [companionFacts.parentId], references: [parents.id] }),
}))

export const remindersRelations = relations(reminders, ({ one }) => ({
  parent: one(parents, { fields: [reminders.parentId], references: [parents.id] }),
}))

export const summarySchedulesRelations = relations(summarySchedules, ({ one }) => ({
  parent: one(parents, { fields: [summarySchedules.parentId], references: [parents.id] }),
}))

export const invitesRelations = relations(invites, ({ one }) => ({
  parent: one(parents, { fields: [invites.parentId], references: [parents.id] }),
  invitedBy: one(users, { fields: [invites.invitedBy], references: [users.id] }),
}))
