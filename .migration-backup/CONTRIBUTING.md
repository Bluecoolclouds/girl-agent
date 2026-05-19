# contributing

```bash
git clone https://github.com/TheSashaDev/girl-agent && cd girl-agent
npm i && npm run dev
```

перед pr — `npm run typecheck` и `npm run build`. не коммить `data/`, `dist/`, `.env`.

перед каждой публичной обновой:

1. обнови версию через `npm version patch|minor|major --no-git-tag-version`;
2. проверь, что версия изменилась в `package.json` и `package-lock.json`;
3. добавь запись в `CHANGELOG.md` с датой и кратким списком изменений;
4. после merge создай и запушь тег той же версии: `git tag vX.Y.Z && git push origin vX.Y.Z`.

публикация в npm запускается GitHub Actions workflow `Publish to npm` по тегу `v*`. В репозитории должен быть Actions secret `NPM_TOKEN`.

легко добавить полезное в:

- `src/presets/llm.ts` — llm-пресеты
- `src/presets/mcp.ts` + `src/mcp/` — mcp-интеграции
- `src/presets/names.ts` — региональные имена
- `src/engine/` — стадии, behavior-tick, гормональная модель

nsfw не принимается. векторные бд и rag не принимаются. крупный рефакторинг — сначала issue.

pr идёт под mit.
