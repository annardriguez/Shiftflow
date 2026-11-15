# Local working copy and iCloud interruption

During Milestone 2, macOS offloaded project files in `Desktop/Projects/hawaiian`. Reads began returning ETIMEDOUT, and the user confirmed iCloud downloads were failing. Finder's Download Now and filesystem download requests did not make all files available.

Development continued at `/Users/annarodriguez/.codex/local-projects/shiftflow`, outside iCloud. The local copy reconstructs only the source written during this chat, preserving its changes rather than restarting the design. Dependencies were installed from their pinned/locked package inputs using local caches and official package registries. The actual final checks are performed against this local copy.

The original `.data/workspace.json` and all other saved restaurant data are untouched. They were not copied into the recovered app; its manager workspace will begin with fictional defaults until you deliberately restore a fully downloaded local data file. The optimization service never writes that workspace file.

Use the local copy for launch and verification while iCloud is unavailable. After iCloud access is restored, the verified source can be copied into the Desktop project. Do not replace the original `.data` when copying source. The service remains localhost-only and fictional-data-only; no public deployment or Strobbo connection occurred.
