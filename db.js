// db.js

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

// --- Configurações de Conexão (Mantidas) ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- Classes de Funções ---

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
    
    async checkConnection() {
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.ping();
            console.log("✅ Conexão MySQL estabelecida com sucesso!");
            await this.setupDatabase(); // <-- Chama a criação das tabelas
        } catch (error) {
            console.error("❌ Falha ao conectar ao MySQL:", error.message);
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }

    // --- NOVO: Lógica de Criação das Tabelas ---
    async setupDatabase() {
        console.log("🛠️ Verificando e criando tabelas...");
        
        // 1. Tabela Administradores (Contém o DONO e os FUNCIONÁRIOS)
        const createAdminsTable = `
            CREATE TABLE IF NOT EXISTS administradores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                -- Role: 'dono' (pode excluir outros admins), 'gerente' (pode criar/editar), 'funcionario' (apenas gerencia pedidos)
                role ENUM('dono', 'gerente', 'funcionario') DEFAULT 'funcionario', 
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        
        // 2. Tabela Compradores
        const createCompradoresTable = `
            CREATE TABLE IF NOT EXISTS compradores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        // 3. Tabela Produtos (Estrutura básica para o futuro CRUD)
        const createProdutosTable = `
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
        `;
        
        // 4. Tabela Pedidos (Estrutura básica para o futuro CRUD)
        const createPedidosTable = `
            CREATE TABLE IF NOT EXISTS pedidos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                comprador_id INT NOT NULL,
                status ENUM('novo', 'preparando', 'saiu_entrega', 'entregue', 'cancelado') DEFAULT 'novo',
                total DECIMAL(10, 2) NOT NULL,
                endereco TEXT NOT NULL,
                FOREIGN KEY (comprador_id) REFERENCES compradores(id)
            );
        `;

        try {
            await pool.execute(createAdminsTable);
            await pool.execute(createCompradoresTable);
            await pool.execute(createProdutosTable);
            await pool.execute(createPedidosTable);
            console.log("✅ Estrutura do Banco de Dados verificada/criada.");
            await this.createInitialAdmin(); // <-- Chama a criação do DONO
        } catch (err) {
            console.error("❌ ERRO FATAL ao criar tabelas:", err);
            // Em caso de erro na criação das tabelas, o servidor não deve iniciar
            process.exit(1); 
        }
    }
    
    // --- NOVO: Criação do Usuário Mestre (DONO) ---
    async createInitialAdmin() {
        const initialEmail = 'admin@dono.com'; // Use um email padrão seguro ou de uma ENV
        const initialPassword = 'senha_mestra_123'; // Use uma senha inicial segura
        
        // 1. Verifica se já existe algum 'dono' ou se o email inicial já está em uso
        const [rows] = await pool.execute('SELECT id FROM administradores WHERE email = ? OR role = "dono"', [initialEmail]);

        if (rows.length === 0) {
            try {
                const saltRounds = 10;
                const passwordHash = await bcrypt.hash(initialPassword, saltRounds);

                const sql = `INSERT INTO administradores (nome, email, password_hash, role) VALUES (?, ?, ?, ?)`;
                await pool.execute(sql, ['Dono Mestre', initialEmail, passwordHash, 'dono']);
                
                console.log(`🔑 Usuário Dono Mestre criado: Email: ${initialEmail}, Senha: ${initialPassword}`);
                console.log("⚠️ ATENÇÃO: Altere esta senha imediatamente após o primeiro login!");

            } catch (err) {
                console.error("❌ Falha ao criar o Dono Mestre inicial:", err);
            }
        }
    }
}

const db = new Database();

// Tenta verificar a conexão e iniciar o setup
db.checkConnection();

module.exports = { db, pool };
