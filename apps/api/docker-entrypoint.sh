#!/bin/sh
set -e

# Aplica as migrations pendentes antes de a API aceitar tráfego.
#
# Só a API faz isto — o worker sobe direto. Se os dois aplicassem, duas réplicas subindo
# ao mesmo tempo tentariam migrar em paralelo. O Prisma usa lock consultivo no Postgres e
# uma delas esperaria, mas depender disso em toda subida é convidar timeout de deploy.
#
# `migrate deploy` só aplica migrations já versionadas: nunca gera, nunca reseta, nunca
# apaga dados. Diferente de `migrate dev`, que jamais deve rodar em produção.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Aplicando migrations..."
  node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma
fi

exec "$@"
