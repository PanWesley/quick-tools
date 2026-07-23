# Quick editor verification

Viewport: 390 × 844 desktop browser emulation.

- Create open: `quick-title` focused; `body.quick-editor-open` active.
- Date parent: one visible dialog; start/end tabs, calendar, time, reminder and repeat all fit the first viewport. Final measured row bottoms: 740, 792 and 844px; extra panel `clientHeight` and `scrollHeight` are both 594px.
- Time child: one visible dialog; explicit all-day/point/range modes; point mode renders two wheels. Confirm returns to the date parent without closing the sheet.
- Surface replacement: priority replaces date directly while the sheet remains open and scroll-locked.
- Full detail: settled rectangle is top 0 / bottom 844; the bottom sheet is hidden and inert. Opening focuses the full-panel Back button; returning focuses `quick-title` and clears toolbar pressed states.
- Draft: backdrop close unlocks the page; reopening restores title and the 2026-07-23–2026-07-25 range.
- Save: reopening after save shows an empty title and disabled save button. The saved task appears on July 23, 24 and 25.
- Pending: destructive schedule cleanup requires inline confirmation; Escape cancels it, restores focus to “待定”, and preserves the original range. Confirming keeps the sheet open, and the explicit pending draft remains pending after close/reopen.
- Accessibility: opening makes the page background inert, Tab/Shift+Tab wrap inside the visible editor, layered Escape navigation works, and save restores focus to the add trigger.
- Tone panel: the 6-column mobile grid has 44px-or-larger swatches and no horizontal overflow at 390px.
- Automated verification: 230 Node tests pass; app/state/database/service-worker syntax checks and `git diff --check` pass.

Screenshots:

- `01-create-keyboard.png`
- `02-date-parent.png`
- `03-time-child.png`
- `04-priority-replace.png`
- `05-full-detail.png`
- `06-draft-restored.png`
- `07-cross-day-calendar.png`
- `08-pending-confirmation.png`
- `visual-comparison.png`

True-device gaps: iOS/Android software-keyboard appearance, native back gestures, VoiceOver/TalkBack reading order and installed-PWA safe-area behavior remain manual checks. Desktop emulation does not mark these as passed.
