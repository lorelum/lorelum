# Backend sessions

This module is the shared Backend boundary for associating host activity with a session and resolving that session's user-level directory. Practice-hints is a consumer: it writes its own `practice-reads.jsonl` file there; future session features should use another feature-specific file in the same directory.

Call `SessionService.resolve(cwd, explicit)` for one association decision. A valid explicit `SessionRef` wins without consulting the working directory. If no explicit identity is available, the service may associate the most specific active shell window whose workspace contains `cwd`, then the most recently started matching window. Windows last 30 minutes and are closed by the matching Post event; lost Post events expire. They exist only in Backend memory and are an approximate fallback, not persistent session state or permission evidence.

The Codex macOS explicit-environment path is intended to avoid opening a Backend window for each Bash call. Linux and Windows currently retain their Pre/Post window fallback until their explicit Hook rewrite paths are separately verified in real hosts. Other hosts may map their shell Pre/Post events to the same `SessionService`; they must not add another feature-specific window.

`sessionDirectory` uses the host's original session ID as the directory name, without a prefix or encoding. IDs must be one path component so Backend file operations remain inside the user session directory. The module does not own feature files, cleanup, or session lifecycle beyond in-memory activity-window expiry.
