// db.js

require('dotenv').config();
const mysql = require('mysql2/promise');

// Configurações do Pool de Conexões MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * @class Database
 * Gerencia a execução de queries usando o pool de conexões MySQL.
 */
class Database {
    /**
     * Executa uma consulta SQL parametrizada.
     * @param {string} sql - A string SQL com placeholders '?'.
     * @param {Array<any>} params - Um array de parâmetros para sanitizar a query.
     * @returns {Promise<{rows: Array<any>, fields: any}>} O resultado da query.
     */
    async query(sql, params) {
        try {
            // O mysql2/promise retorna um array de [rows, fields]
            const [rows, fields] = await pool.execute(sql, params);
            
            // Retorna um objeto que simula o formato comumente usado em Node.js
            return { rows, fields };

        } catch (error) {
            console.error("❌ ERRO NO BANCO DE DADOS (MySQL):", error.message);
            // Rejeita a promise para que o Controller possa lidar com o erro (try/catch)
            throw error;
        }
    }

    /**
     * Obtém uma conexão direta do pool (útil para transações).
     * @returns {Promise<mysql.PoolConnection>} A conexão.
     */
    async getConnection() {
        return await pool.getConnection();
    }
    
    // Método para verificar se a conexão está OK (opcional, mas útil)
    async checkConnection() {
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.ping();
            console.log("✅ Conexão MySQL estabelecida com sucesso!");
        } catch (error) {
            console.error("❌ Falha ao conectar ao MySQL:", error.message);
            throw error;
        } finally {
            if (connection) connection.release(); // Sempre libere a conexão
        }
    }
}

const db = new Database();

// Tenta verificar a conexão ao iniciar o servidor
db.checkConnection();

module.exports = { db, pool };
