#!/bin/bash
# Снимок БД: в git-трекаемый db/snapshots/ (уходит на GitHub при push)
# и в /tmp/my-project/db/ (переживает сброс песочницы).
# Запускать после важных изменений данных: bash download/db-snapshot.sh
cd /home/z/my-project
TS=$(date +%Y-%m-%d-%H%M)
mkdir -p db/snapshots
cp db/custom.db "db/snapshots/snapshot-$TS.db"
mkdir -p /tmp/my-project/db
cp db/custom.db "/tmp/my-project/db/custom.db.snapshot-$TS"
ls -lh "db/snapshots/snapshot-$TS.db"
