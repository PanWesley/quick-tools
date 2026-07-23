# Quick editor verification

Viewport: 390 × 844 desktop browser emulation.

- Create open: `quick-title` focused; `body.quick-editor-open` active.
- Date parent: one visible dialog; start/end tabs, calendar, time, reminder and repeat all fit the first viewport. Final measured row bottoms: 740, 792 and 844px; extra panel `clientHeight` and `scrollHeight` are both 612px.
- Time child: one visible dialog; explicit all-day/point/range modes; point mode renders two wheels. Confirm returns to the date parent without closing the sheet.
- Surface replacement: priority replaces date directly while the sheet remains open and scroll-locked.
- Full detail: settled rectangle is top 0 / bottom 844; the bottom sheet is hidden and inert. Opening focuses the full-panel Back button; returning focuses `quick-title` and clears toolbar pressed states.
- Draft: backdrop close unlocks the page; reopening restores title and the 2026-07-23–2026-07-25 range.
- Save: reopening after save shows an empty title and disabled save button. The saved task appears on July 23, 24 and 25.

Screenshots:

- `01-create-keyboard.png`
- `02-date-parent.png`
- `03-time-child.png`
- `04-priority-replace.png`
- `05-full-detail.png`
- `06-draft-restored.png`
- `07-cross-day-calendar.png`
- `visual-comparison.png`

True-device gaps: iOS/Android software-keyboard appearance, native back gestures, VoiceOver/TalkBack reading order and installed-PWA safe-area behavior remain manual checks. Desktop emulation does not mark these as passed.
