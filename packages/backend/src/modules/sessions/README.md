# Backend sessions

This module is the shared Backend boundary for associating host activity with a session and resolving that session's user-level directory. Practice-hints is a consumer: it writes its own `practice-reads.jsonl` file there; future session features should use another feature-specific file in the same directory.

Call `SessionService.resolve(cwd, explicit)` for one association decision. A valid explicit `SessionRef` wins without consulting the working directory. If no explicit identity is available, the service may associate the most specific active shell window whose workspace contains `cwd`, then the most recently started matching window. Windows last 30 minutes and are closed by the matching Post event; lost Post events expire. They exist only in Backend memory and are an approximate fallback, not persistent session state or permission evidence.

Codex uses explicit session environment variables on macOS, Linux, and Windows instead of opening a Backend window for each shell call. Unix shells receive `export` statements; native Windows PowerShell receives `$env:` assignments. The macOS path has been exercised on a real Codex host; Linux and Windows host-level rewrite, inheritance, and permission behavior require separate verification. Other hosts may map their shell Pre/Post events to the same `SessionService` when they cannot pass an explicit identity; they must not add another feature-specific window.

`sessionDirectory` uses the host's original session ID as the directory name, without a prefix or encoding. IDs must be one path component so Backend file operations remain inside the user session directory. The module does not own feature files, cleanup, or session lifecycle beyond in-memory activity-window expiry.
