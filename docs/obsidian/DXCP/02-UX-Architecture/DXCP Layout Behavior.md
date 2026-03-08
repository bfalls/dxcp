# DXCP Layout Behavior

## Purpose

Define the global layout behavior for the DXCP user interface.

This document specifies how major layout regions behave in the viewport,
including fixed elements, scrolling regions, and sticky panels.

These rules apply to all DXCP screens unless explicitly overridden.

The goal is to ensure consistent behavior across the product and prevent
layout drift during implementation.

---

# Layout Regions

The DXCP interface is composed of several major layout regions.

```
Top Navigation
Alert Rail
Page Header
Primary Content Column
Secondary Context Column
```

Each region has defined scrolling behavior.

---

# Top Navigation

The Top Navigation bar provides global navigation.

Example:

```
+------------------------------------------------------------------+
| DXCP | Applications | Deployments | Insights | Admin | (User)    |
+------------------------------------------------------------------+
```

Behavior:

- Fixed position
- Always visible
- Does not scroll

Purpose:

Provide a constant navigation anchor so users can quickly move between
major sections of the system and reliably access authenticated user actions.

Rules:

- Appears on every screen
- Never scrolls out of view
- Height should remain stable across screens
- Includes a compact authenticated user menu on the right side
- The authenticated user menu shows signed-in identity and a logout action
- Role does not need to be shown in the top navigation by default

---

# Alert Rail

The Alert Rail displays important system messages.

Example:

```
+------------------------------------------------------------------+
| Deployment blocked by policy                                     |
| Reason: concurrency limit reached                                |
+------------------------------------------------------------------+
```

Behavior:

- Scrolls with page content
- Not fixed

Purpose:

Communicate temporary system messages without permanently consuming
screen space.

Rules:

- Appears only when needed
- May contain validation errors or system warnings
- Multiple alerts should stack vertically
- Alerts disappear when the condition is resolved

---

# Page Header

The Page Header identifies the current object and exposes primary actions.

Example:

```
Application: payments-api                          [ Deploy ]
```

Behavior:

- Scrolls with page content

Purpose:

Display the current object context and expose primary actions.

Rules:

- Always visible when the page loads
- May scroll off screen as the user navigates content
- Primary action should be located in the header when applicable

Example primary actions:

```
Deploy
Refresh
Rollback
```

---

# Primary Content Column

The Primary Content Column contains the main operational data for the screen.

Example sections:

```
Running Version
Deployment Timeline
Failures
```

Behavior:

- Scrollable
- Contains the majority of page content

Purpose:

Present the most important operational information for the current object.

Rules:

- Should visually dominate the layout
- Important information should appear above the fold when possible
- Content sections should be stacked vertically

---

# Secondary Context Column

The Secondary Context Column provides supporting information.

Example sections:

```
Deployment Group
Guardrails
Allowed Strategies
```

Behavior:

- Sticky within viewport

Meaning:

The column remains visible while the user scrolls the primary content,
until the bottom of the page is reached.

Purpose:

Ensure policy context remains visible while users inspect deployments
or failures.

Rules:

- Should contain read only contextual information
- Should not dominate the visual layout
- Panels should be stacked vertically
- Should stay selective and compact rather than becoming a second primary column
- Sticky behavior should disable when the column becomes too tall to remain helpful

---

# Two Column Layout

Most operational screens use a two column layout.

Example structure:

```
+------------------------------------+-----------------------------+
| Primary Column                     | Secondary Column            |
|                                    |                             |
| Running Version                    | Deployment Group            |
| Recent Deployment Activity         | Guardrails                  |
| Recent Failures                    | Allowed Strategies          |
+------------------------------------+-----------------------------+
```

Rules:

- Primary column width should be larger than secondary column
- Secondary column should remain visible while scrolling when helpful
- Content must remain readable without horizontal scrolling
- Wide screens should add outer whitespace, not extra equal-weight panels

---

# Responsive Behavior

When viewport width decreases, the two column layout collapses into a
single column layout.

Example order:

```
Running Version
Recent Deployment Activity
Recent Failures
Deployment Group
Guardrails
Allowed Strategies
```

Rules:

- Primary column sections appear first
- Secondary column sections appear after primary content
- Layout must remain readable on smaller screens
- Responsive collapse should preserve meaning, not promote secondary context above the main story

---

# Scrolling Principles

The DXCP interface follows several scrolling principles.

Navigation remains visible

```
Top Navigation is always fixed
```

Temporary messages do not consume permanent space

```
Alert Rail scrolls with page
```

Operational data is scrollable

```
Primary content scrolls normally
```

Policy context remains visible

```
Secondary column is sticky
```

Scrolling is for reading depth, not for basic comprehension

```
Users should understand the current state before deep scroll is required
```

These rules create a stable and predictable interaction model.

---

# Consistency Requirement

All screens in DXCP must follow the layout behavior defined in this document.

Screen specific documents such as:

```
Application-Screen.md
Deployment-Screen.md
```

should reference this document rather than redefining layout behavior.

Example reference:

```
Layout behavior follows DXCP-Layout-Behavior.md
```

This ensures a single source of truth for interface structure.

---

This layout model is used by:

[[Application Screen]]

[[Deployment Screen]]

---

# Summary

The DXCP layout model defines consistent behavior across all screens.

Key principles:

```
Top Navigation is fixed
Alert Rail scrolls with content
Page Header scrolls with content
Primary content scrolls normally
Secondary column is sticky
```

These rules ensure predictable navigation, clear operational visibility,
and stable UI behavior across the system.