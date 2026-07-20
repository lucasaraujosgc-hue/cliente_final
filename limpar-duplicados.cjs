const { Pool } = require('pg');

// Certifique-se de que a variável de ambiente DATABASE_URL está disponível
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("Iniciando a remoção de guias/documentos duplicados...");
    
    // A query abaixo identifica documentos com o mesmo:
    // client_id, titulo, categoria, data de vencimento e competência.
    // Ela mantém o registro mais antigo (ORDER BY created_at ASC) e exclui as duplicatas (row_num > 1).
    const sql = `
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER(
                 PARTITION BY client_id, title, category, due_date, competence
                 ORDER BY created_at ASC
               ) as row_num
        FROM documents
      )
      DELETE FROM documents
      WHERE id IN (
        SELECT id FROM duplicates WHERE row_num > 1
      )
      RETURNING id, title;
    `;
    
    const result = await client.query(sql);
    console.log(`Limpeza concluída com sucesso!`);
    console.log(`${result.rowCount} registros duplicados foram removidos do banco de dados.`);
    
  } catch(e) {
    console.error("Erro durante a execução:", e);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
