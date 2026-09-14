# Dubina

Кроссплатформенный голосовой запуск сценариев для macOS, Windows и Linux.

## Стек

- Tauri 2 + React + TypeScript
- Локальные сценарии (без облака и без оплаты)
- Ответы голосом через TTS (текст в `src/audio/soundPlayer.ts`)

## Запуск

```bash
npm install
source "$HOME/.cargo/env"
npm run tauri dev
```

## Голос

На главной слушает микрофон (Vosk, русский). Под орбом — субтитры после «Дубина».

Ответы — TTS (Piper или системный голос). Модель: `public/vosk-ru-small.bin`.

Музыка: в настройках выбери плеер → скажи «включи музыку».

## Сборка

```bash
npm run tauri build
```

Сборку под Windows / Linux удобнее гонять в CI на соответствующих ОС.
