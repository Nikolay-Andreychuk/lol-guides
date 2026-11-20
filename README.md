# ARAM гайды

Android-приложение с гайдами по чемпионам League of Legends для классического ARAM (русский язык). Гайды заранее генерирует агент, приложение работает без сети и само подтягивает новые гайды после патча.

ARAM гайды isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Устройство
- `content/aram/ru/` — гайды (по файлу на чемпиона) и словарь ситуаций `situations.json`. Источник правды; история git — история гайдов.
- `content/aram/mode.json` — правила режима: карта, заклинания, стартовое золото, проверенный список предметов, которые есть только на карте режима.
- `pipeline/` — скрипты на bun: данные Riot, генерация, проверка, пакет, публикация.
- `.claude/skills/aram-guide/SKILL.md` — правила гайда для агента, включая правила названий ситуаций.
- `app/` — приложение (Kotlin, Jetpack Compose).

## После патча — одна команда
```bash
bun pipeline patch
```
Скачивает данные Riot, сразу публикует пакет со старыми гайдами (в приложении появятся жёлтые метки), перегенерирует устаревшие гайды, сводит новые названия ситуаций в словарь и публикует итоговый пакет. Если упёрлась в лимит подписки — запустите ещё раз позже, готовые гайды пропускаются.

Отдельные шаги: `sync`, `generate [--only Ahri,Jinx] [--force] [--limit N]`, `situations`, `pack`, `publish`. `--force` пишет гайд заново, не опираясь на прошлый. Журналы запусков агента — `cache/runs/`.

Гайды пишет Codex CLI (`codex exec`, вход через ChatGPT) моделью `gpt-6.1-sol`. Настройки через переменные окружения:
- `ARAM_MODEL` — другая модель Codex, например `gpt-6.2-sol`, когда она станет доступна;
- `ARAM_PARALLEL` — сколько чемпионов генерировать одновременно (по умолчанию 3);
- `ARAM_CODEX_HOME` — отдельный каталог Codex со своим `codex login`, чтобы в контекст агента не попадал ваш `~/.codex/AGENTS.md`.

Если `sync` пишет про новые предметы карты режима — проверьте их и допишите в `itemReview` в `content/aram/mode.json`.

## Приложение
```bash
bun pipeline pack
cd app && ./gradlew assembleDebug
```
`pack` кладёт свежий пакет гайдов в `app/app/src/main/assets/pack.zip`: без него сборка не начнётся. Новые гайды приложение скачивает из релиза `content` этого репозитория, туда их выкладывает `bun pipeline publish`. Адрес задаёт `contentBaseUrl` в `app/gradle.properties`; пустое значение отключает обновления. Адрес вшит в каждую сборку: если сделать репозиторий приватным, переименовать релиз `content` или перенести пакеты, установленные приложения молча перестанут получать гайды.

## Тесты
```bash
bun test pipeline
```
