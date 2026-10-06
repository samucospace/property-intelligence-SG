export async function up(conn) {
  for(const table of ['property_transactions','rental_transactions']) {
    await conn.run(`ALTER TABLE ${table} ADD COLUMN source_district TEXT`);
    // Legacy values remain NULL: a project district is not original transaction-level evidence.
  }
}
