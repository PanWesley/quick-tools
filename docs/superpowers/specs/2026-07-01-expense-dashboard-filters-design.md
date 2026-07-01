# Expense Dashboard Filters Design

Date: 2026-07-01
Status: Approved for implementation

## Goal

Make the overview page use one clear filter context. The top filter row defines which expenses are being analyzed, and every dashboard surface follows it: hero total, category share, Top 5, and spending trend.

## Current Problem

The overview page currently mixes several contexts. The top row filters records by time, tags, amount, and search. Category share can switch between tags and groups, but it cannot focus on one tag group. Top 5 always aggregates the legacy `category` field. The trend chart has its own time selector, so it can disagree with the top row.

## User Model

The page should answer two separate questions:

- Top filters: which records am I looking at?
- Analysis dimension: how should those records be broken down?

This keeps the primary flow simple while still supporting grouped tags.

## Proposed Experience

The top filter row remains global. Time, selected tags, amount range, and search affect every dashboard section.

Category share and Top 5 share one analysis selector:

- `消费类型` by default: show tags inside the consumption-type group.
- Other tag groups: show tags inside that group.
- `全部分组`: show group-level share and Top 5.

The trend chart removes its own time selector. Its title follows the global time range, and it plots only the globally filtered expenses. Long ranges are grouped by month; shorter ranges are grouped by day.

When a whole group is selected in the top tag popup, the selected filter chips can show a compact group chip instead of flooding the filter row with every child tag.

## Data Rules

- Filtering is record-level. If any selected tag is present on an expense, the expense is included.
- `全部分组` aggregation splits an expense amount evenly across the unique tag groups on that expense. Untagged expenses go to `未分类`.
- Specific group aggregation only uses tags in that group. If an expense has multiple tags in the selected group, the amount is split evenly across those tags.
- Legacy `expense.category` is no longer the chart source when tag metadata is available. It remains available for text search and existing list behavior.

## Files

- `tools/expense/index.html`: remove the trend-only selector and add a chart analysis selector.
- `tools/expense/js/chart.js`: expose pure dashboard filter and aggregation helpers, render all charts from one filtered dataset.
- `tools/expense/js/app.js`: collect dashboard filters, set the default analysis group, render compact selected chips, and reuse the shared filtered dataset for hero stats.
- `tools/expense/js/chart.test.js`: regression tests for filters, focused group aggregation, Top 5 behavior, and trend bucketing.
- Release metadata files: sync version and changelog if the implementation changes shipped behavior.

## Verification

- Run the new chart tests and the existing JS tests.
- Run syntax checks for `tools/expense/js/*.js` and `tools/expense/sw.js`.
- Run `git diff --check`.
- Browser check the local dashboard route on a fresh origin or port because this PWA uses service worker caching.
