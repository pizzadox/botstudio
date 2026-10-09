#!/bin/bash
# Пуш в GitHub после каждого изменения (токен из .env.local, вне репозитория)
cd /home/z/my-project
# Токен: строка вида ghp_... ИЛИ GITHUB_TOKEN=ghp_... (IMP-25-INT: оба формата)
TOKEN=$(sed -n 's/^ghp_.*/&/p; s/^GITHUB_TOKEN=//p' .env.local | grep '^ghp_' | head -1)
MSG="${1:-update}"
git add -A
if git diff --cached --quiet; then
  echo "nothing to commit"
  exit 0
fi
git -c user.name="pizzadox" -c user.email="pizzadox@users.noreply.github.com" commit -m "$MSG" -q
git push -q "https://x-access-token:${TOKEN}@github.com/pizzadox/botstudio.git" main 2>&1 | rg -v "token" || true
git log --oneline | head -1
