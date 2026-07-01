# Expense Dashboard Insights Design

Date: 2026-07-01
Status: Approved for implementation

## Goal

Add three intuitive overview modules above the existing charts: spending pace, monthly calendar heatmap, and anomaly reminders. These modules should make the dashboard answer "am I spending too fast?", "which days were heavy?", and "what deserves attention?" without adding another filter system.

## Experience

The top dashboard filters remain global. The new insight modules use the same filtered expenses and date range as the hero, category share, Top 5, and trend charts.

The dashboard order becomes:

1. Global filters
2. Hero total
3. Insight strip
   - `支出节奏`: compares elapsed period progress with spending progress. The reference amount is the previous period total when available, otherwise the current period total.
   - `本月日历热力图`: shows daily spending intensity across the selected date range. Short ranges render day cells; long ranges remain compact and scroll naturally.
   - `异常提醒`: shows up to three concise cards for unusually high daily spending, large single expenses, and category/tag increases.
4. Existing category share, Top 5, and trend charts

## Data Rules

- Use the already filtered dashboard expenses.
- Spending pace uses the current date range, current total, elapsed ratio, spending ratio, and a reference total.
- Heatmap buckets by `expense.date` and normalizes intensity against the highest daily total in the filtered range.
- Insight cards should be deterministic and local-only. If there is not enough signal, show calm empty states instead of alarming copy.

## Files

- `tools/expense/js/chart.js`: add pure helper functions for pace, heatmap, and insight cards.
- `tools/expense/js/chart.test.js`: add tests for those helper functions.
- `tools/expense/js/app.js`: render the new modules from the shared dashboard dataset.
- `tools/expense/index.html`: add the insight strip markup.
- `tools/expense/css/style.css`: style the new modules for desktop and mobile.
- Release metadata: sync version, changelog, cache name, and asset test expectations.

## Constraints

- Keep the dashboard compact and practical.
- Do not add extra filters.
- Do not require budgets or new database fields for this first version.
- Do not block the current category/Top5/trend chart flow.
