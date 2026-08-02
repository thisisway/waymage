-- Administrador da plataforma.
--
-- E a unica permissao fora do escopo de workspace, e o unico caminho do sistema que atravessa
-- deliberadamente o isolamento entre eles. Coluna, e nao lista em variavel de ambiente: a
-- coluna deixa rastro de quando alguem entrou e saiu dela.
--
-- Ninguem nasce administrador. Conceder e um UPDATE explicito, feito por quem tem acesso ao
-- banco — o que mantem a concessao fora do alcance de qualquer rota da API.
ALTER TABLE "users" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
