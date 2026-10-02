#!/bin/bash
# Пуш в GitHub после каждого изменения (токен из .env.local, вне репозитория)
cd /home/z/my-project
TOKEN=$(sed -n 's/^ghp_/ghp_/p' .env.local | head -1)
MSG="${1:-update}"
git add -A
git -c user.name="pizzadox" -c user.email="pizzadox@users.noreply.github.com" commit -m "$MSG" --allow-empty -q
git push -q "https://x-access-token:${TOKEN}@github.com/pizzadox/botstudio.git" main 2>&1 | rg -v "token" || true
git log --oneline | head -1
