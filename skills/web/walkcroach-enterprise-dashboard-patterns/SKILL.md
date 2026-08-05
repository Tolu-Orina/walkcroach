---
name: walkcroach-enterprise-dashboard-patterns
description: Design patterns for enterprise-grade dashboards, admin panels, and internal tools — role-based views, permission-aware UI, information density, and multi-persona navigation. Use this skill whenever building or reviewing a dashboard, admin panel, back-office tool, B2B SaaS product, or any interface serving multiple user roles (admin, manager, operator, analyst). This is distinct from marketing/landing page work — enterprise UI is judged on information density and workflow support, not visual flair alone.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design`. Prefer Graphite Lumen tokens when the surface is WalkCroach-branded; customer brand tokens win for customer creatives.
# Enterprise Dashboard Patterns

Enterprise software rarely serves one user type. Designing the same screen for an admin, a manager, and a front-line operator increases cognitive load and slows everyone down. This skill covers what makes enterprise UI feel "world-class" beyond visual polish: it supports real, high-stakes work.

## Role-specific views, not one-size-fits-all

- **Leaders/managers** need high-level summary views — KPIs, trends, exceptions that need attention.
- **Operators/analysts** need task-driven views — the specific records, queues, or actions relevant to their job, not a company-wide overview.
- Do not build a single dashboard and hope role-based filtering alone solves this — design the layout itself around what each role is trying to accomplish, then use permissions to control access to it.

## Permission-aware UI, not permission-aware data only

UI elements should adapt based on what the current user is allowed to do, not just what data they can see:
- Hide (don't just disable) actions a role can never perform — a greyed-out button a user can never click is a UX event that provides false expectation.
- Disable (with a clear reason) actions that are contextually blocked but normally available (e.g. "Approve" disabled because the record is already approved).
- Never rely on hiding via CSS alone — if the underlying action is exposed via API without a permission check, that's a security issue, not a UI issue; flag this if noticed.

## Shared interaction patterns across roles

Even when views differ, the same action (e.g. "export," "filter," "bulk edit") must look and behave identically everywhere it appears. This consistency is what allows users to collaborate and hand off work between roles without relearning the interface.

## Information density is a feature, not a flaw

Unlike consumer/marketing UI, enterprise interfaces are correctly denser: data tables, multi-column layouts, and compact controls are appropriate when the user is a trained daily operator, not a first-time visitor. Resist the instinct to "simplify" an enterprise screen the way you would a landing page — instead, use progressive disclosure (expandable rows, drill-down detail panels, filters) to manage density without hiding needed information by default.

## Progressive innovation over radical redesign

Enterprise users build muscle memory around daily workflows. A redesign that changes core interaction patterns overnight causes real productivity loss and adoption failure, even if the new design is objectively better. Prefer changes that mirror existing behavior while adding efficiency (e.g., adding a faster shortcut path alongside the existing flow) over wholesale reinvention, unless the user has explicitly asked for a full modernization.

## Required components for a credible enterprise build

- Role-based navigation (sidebar/nav items change based on permissions, not just page content)
- Data tables with sort, filter, column visibility control, and pagination or virtualization for large datasets
- Bulk action support (select multiple rows → apply one action) for any list-heavy screen
- Audit-visible actions — where relevant, show who did what and when (critical for regulated/compliance-adjacent products like HealthTech or FinTech)
- Search that scopes correctly to the current role's accessible data

## Pre-ship checklist
- [ ] At least two distinct role-based views exist where the product has more than one user type — not one view with everything visible
- [ ] Every primary action checks permission before rendering, not just before executing
- [ ] Shared actions (filter, export, bulk-edit) look and behave identically across every screen they appear on
- [ ] Dense screens use progressive disclosure rather than either overwhelming or oversimplifying the view
- [ ] Navigation and layout changes, if any, preserve familiar patterns rather than relearning the whole flow
