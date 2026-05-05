# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RoboArena — a new project bootstrapped with Next.js 16, React 19, TypeScript, Tailwind CSS v4, and lucide-react.

## Commands

```bash
npm run dev        # Start dev server (http://localhost:3000)
npm run build      # Production build
npm run start      # Serve production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit (add this script if missing)
```

Run a single test file (once tests are set up):
```bash
npx jest path/to/file.test.ts
```

## Stack

- **Next.js 16 + React 19 + TypeScript** — App Router (`app/` directory)
- **Tailwind CSS v4** — utility-first styling; no `tailwind.config.js` needed for v4 (config lives in CSS via `@theme`)
- **lucide-react** — icon library

## Conventions

- Components live in `src/components/`, pages in `src/app/`
- All clickable elements (buttons, links, expandable text) must have `cursor-pointer`
- Prefer Server Components by default; add `"use client"` only when needed (event handlers, hooks, browser APIs)
