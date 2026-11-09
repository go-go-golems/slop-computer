# Tasks

## TODO
- [x] Ticket, design doc (01) and diary <!-- t:pex3 -->
- [x] Step 0: merge #38 (actor VM) into #39's branch; reconcile pkg/actor; tests in both runtime modes <!-- t:brbc -->
- [x] F1 (P1): apps rule write self; registerApp/unregisterApp actor actions; page calls them; trust hashes the source; log refuses reverting app changes <!-- t:jckq -->
- [x] F2: PB.isAssetRef is the only asset classifier (board clip, drops) <!-- t:ujjq -->
- [x] F3: UTF-8 byteLength in core.js; logEntry trims by bytes <!-- t:1fwn -->
- [x] F7: window state defaults applied at read time (makeCtx, page and frame) <!-- t:1x6d -->
- [x] F6: steps.js step table shared by frame and page; function args resolved in the frame; malformed steps refused; differential test <!-- t:7aqf -->
- [x] F4: CLI app-verb tree dispatches by a one-word token (typed word or store id) <!-- t:hpme -->
- [x] F5: verb cache directory keyed by the full normalized server URL <!-- t:ousy -->
- [x] F8: Actor.Watch; a turn rolls back when a watched promise rejects in it; toolRunner watches tool promises <!-- t:11ju -->
- [x] Browser pass: trust prompt, Moodboard pop-out after reload, framed update(id, fn), counter defaults on an old record <!-- t:ekq7 -->
- [x] Consolidate: #39 retargeted to main and rewritten; #36, #37, #38 closed pointing to #39; CI green <!-- t:nc5e -->
- [ ] Security: Pinboard's App editor 'Describe IR' button (apps/pinboard/js/apps.js:220) runs c.apps.evalSource(c.state.src) in the page realm, not narrowed and not in a sandboxed frame; the editor's source is shared window state, so someone at interact (or a framed app via a setState step) can stage code that runs with the viewer's page authority when the viewer presses the button. Register also evaluates in the page before the server's admin check. Fix: describe in the frame (or without evaluating), and add a test. Found 2026-11-09 while writing a spec that was then dropped. <!-- t:hkef -->
