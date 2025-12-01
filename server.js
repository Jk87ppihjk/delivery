// server.js

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); // <-- NOVO: Importa o pacote CORS

const { compradorRouter } = require('./compradorAuth');
const { adminRouter } = require('./adminAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------------
// CONFIGURAÇÃO CORS: LIBERA TODAS AS ORIGENS
// Isso permitirá que seu frontend (127.0.0.1) se comunique com o backend (Render)
// Em produção, você DEVE restringir isso ao seu FRONTEND_URL.
// ------------------------------------------------------------------
app.use(cors()); // <-- NOVO: Aplica o middleware CORS sem restrições
// ------------------------------------------------------------------

// Middlewares
app.use(bodyParser.json());

// Rotas de Autenticação
app.use('/api/comprador', compradorRouter);
app.use('/api/admin', adminRouter);

// Rota de Teste
app.get('/', (req, res) => {
    res.send('Servidor Node.js rodando! Use /api/comprador ou /api/admin');
});

// Inicia o Servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
});
