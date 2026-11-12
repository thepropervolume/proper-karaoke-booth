# Filename and Folder Templates

Open **Preferences → Library Settings**. Each line is a pattern; the first matching pattern wins. Repeating a field is supported. For example, the artist in a folder and filename can both appear as `${Artist}`. Their values must agree after trimming, ignoring case; a mismatch needs review instead of silently changing the artist.

These patterns are accepted. Put specific patterns before a catch-all:

```text
${DJ Code}-${Track Number} - ${Artist} - ${Title}
${Artist}/${Artist} - ${Title}
${Artist}/${Track Number} - ${Artist} - ${Title}
${Artist}/${Track Number}.${Title}
${Track Number}.${Artist} - ${Title}
${Artist}/${Title}
```

`${Track Name}` is an alias for `${Title}`. Custom placeholders such as `${Album}`, `${Year}` or `${Unused Label}` may capture unused parts of a path; they do not create or overwrite artist/title fields. Repeated custom placeholders may have different values. Use a literal separator between variables: adjacent variables do not provide enough information to split safely. Use `/` between directories.

Saving templates does not modify existing song metadata or source files. Newly imported songs use the saved templates. Multiple possible interpretations are marked for metadata review rather than guessed. Patterns and search work are bounded so a malformed template cannot freeze a show; the current limits are 32 patterns, 512 characters per pattern and a bounded parse search.

Developer verification is in `tests/domain/metadata-templates.test.ts`, including all six requested formats, repeated fields, unused custom placeholders, conflicting repeated values, ambiguous splits and path/length limits.
