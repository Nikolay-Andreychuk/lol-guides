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

## Выпуск приложения
Друзья ставят APK из релиза `app-vN`. Android ставит новую версию поверх старой, только если обе подписаны одним ключом, поэтому каждый выпуск подписывается ключом выпуска.

Ключ лежит вне репозитория, в `~/.android/aram-guides-release.jks` (псевдоним `aram-guides`). Путь к нему и пароль Gradle берёт из `~/.gradle/gradle.properties`:
```properties
aramReleaseStoreFile=/Users/<вы>/.android/aram-guides-release.jks
aramReleasePassword=<пароль>
```
Копия файла ключа и пароля хранится в менеджере паролей. На новом компьютере верните файл на место и допишите эти две строки. Если ключ потерян, новую версию можно поставить только после удаления старой, и у пользователя пропадёт список недавних чемпионов. Без этих строк `assembleRelease` соберёт неподписанный APK, который телефон не установит.

Выпуск версии N:
1. В `app/app/build.gradle.kts` поднимите `versionCode` и `versionName` до N.
2. Соберите пакет и APK: `bun pipeline pack && (cd app && ./gradlew assembleRelease)`.
3. Опубликуйте APK, затем пакет: `cp app/app/build/outputs/apk/release/app-release.apk dist/aram-guides-vN.apk && gh release create app-vN dist/aram-guides-vN.apk --title "Приложение, версия N" && bun pipeline publish`. Пакет идёт вторым: если в нём поднята схема, старые приложения сразу покажут «Есть новая версия приложения», и ссылка должна вести уже на новый APK.

Строка «Есть новая версия приложения» открывает последний релиз репозитория. Релиз `content` создан с `--latest=false`, поэтому последним всегда остаётся свежий `app-vN`.

## Тесты
```bash
bun test pipeline
bun pipeline pack && (cd app && ./gradlew testDebugUnitTest)
```
Тесты приложения читают собранный пакет: так проверяется, что приложение понимает то, что собирает конвейер.
