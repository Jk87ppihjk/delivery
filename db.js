// db.js (Atualizado com Imagens_Produto)

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

// --- Configurações do Pool de Conexões MySQL ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- Classe Database para Execução de Queries ---
class Database {
    async query(sql, params) {
        try {
            const [rows, fields] = await pool.execute(sql, params);
            return { rows, fields };
        } catch (error) {
            console.error("❌ ERRO NO BANCO DE DADOS (MySQL):", error.message);
            throw error;
        }
    }

    async getConnection() {
        return await pool.getConnection();
    }
    
    // Verifica a conexão e inicia o setup do DB
    async checkConnection() {
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.ping();
            console.log("✅ Conexão MySQL estabelecida com sucesso!");
            await this.setupDatabase(); // <-- Inicia a verificação/criação das tabelas
        } catch (error) {
            console.error("❌ Falha ao conectar ao MySQL:", error.message);
            process.exit(1); 
        } finally {
            if (connection) connection.release();
        }
    }

    // --- Lógica de Criação de Tabelas (Migrations Simples) ---
    async setupDatabase() {
        console.log("🛠️ Verificando e criando tabelas...");
        
        const tableQueries = [
            `
            CREATE TABLE IF NOT EXISTS administradores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('dono', 'gerente', 'funcionario') DEFAULT 'funcionario', 
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            `,
            `
            CREATE TABLE IF NOT EXISTS compradores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            `,
            `
            CREATE TABLE IF NOT EXISTS produtos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                descricao TEXT,
                preco DECIMAL(10, 2) NOT NULL,
                categoria VARCHAR(50),
                disponivel BOOLEAN DEFAULT TRUE,
                created_by INT,
                FOREIGN KEY (created_by) REFERENCES administradores(id)
            );
            `,
            `
            CREATE TABLE IF NOT EXISTS pedidos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                comprador_id INT NOT NULL,
                status ENUM('novo', 'aceito', 'preparando', 'saiu_entrega', 'entregue', 'cancelado') DEFAULT 'novo',
                total DECIMAL(10, 2) NOT NULL,
                endereco TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (comprador_id) REFERENCES compradores(id)
            );
            `,
            `
            CREATE TABLE IF NOT EXISTS itens_pedido (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT NOT NULL,
                produto_id INT NOT NULL,
                quantidade INT NOT NULL,
                preco_unitario DECIMAL(10, 2) NOT NULL,
                FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
                FOREIGN KEY (produto_id) REFERENCES produtos(id)
            );
            `,
            `
            CREATE TABLE IF NOT EXISTS imagens_produto (
                id INT AUTO_INCREMENT PRIMARY KEY,
                produto_id INT NOT NULL,
                url VARCHAR(255) NOT NULL,
                public_id VARCHAR(255),
                is_main BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
            );
            ` // <-- NOVO: Tabela para URLs de Imagens
        ];

        try {
            for (const sql of tableQueries) {
                await pool.execute(sql);
            }
            console.log("✅ Estrutura do Banco de Dados verificada/criada.");
            await this.createInitialAdmin(); 
        } catch (err) {
            console.error("❌ ERRO FATAL ao criar tabelas:", err);
            process.exit(1); 
        }
    }
    
    // --- Criação do Usuário Mestre (DONO) ---
    async createInitialAdmin() {
        const initialEmail = 'admin@dono.com'; 
        const initialPassword = 'senha_mestra_123'; 
        
        const [rows] = await pool.execute('SELECT id FROM administradores WHERE email = ? OR role = "dono"', [initialEmail]);

        if (rows.length === 0) {
            try {
                const saltRounds = 10;
                const passwordHash = await bcrypt.hash(initialPassword, saltRounds);

                const sql = `INSERT INTO administradores (nome, email, password_hash, role) VALUES (?, ?, ?, ?)`;
                await pool.execute(sql, ['Dono Mestre', initialEmail, passwordHash, 'dono']);
                
                console.log(`\n🔑 USUÁRIO DONO CRIADO:`);
                console.log(`   Email: ${initialEmail}`);
                console.log(`   Senha: ${initialPassword}`);

            } catch (err) {
                console.error("❌ Falha ao criar o Dono Mestre inicial:", err);
            }
        }
    }
}

const db = new Database();
db.checkConnection();

module.exports = { db, pool };
