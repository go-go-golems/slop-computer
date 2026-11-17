// inventory backend - DO NOT TOUCH unless you know what your doing
// v1.3 (contractor) last edit: added doStuff for the owner
var sql = use('sql');
var DEBUG = true;

function log(x) { if (DEBUG) console.log('[inv]', x); }

defineActor({
  actions: {
    getAll: {
      requires: 'view',
      run: function (ctx) {
        var rows = sql.all('SELECT * FROM tbl_inv');
        log('getAll ' + rows.length);
        return rows;
      }
    },
    save: {
      requires: 'interact',
      run: function (ctx, a) {
        // a = {id?, nm, qty, prc}
        if (a.id) {
          sql.run('UPDATE tbl_inv SET Nm=?, Qty=?, Prc=?, upd=? WHERE ID=?', a.nm, a.qty, a.prc, new Date().toISOString().slice(0, 10), a.id);
        } else {
          sql.run('INSERT INTO tbl_inv (Nm, Qty, Prc, upd) VALUES (?,?,?,?)', a.nm, a.qty, a.prc, new Date().toISOString().slice(0, 10));
        }
        return 'ok';
      }
    },
    del: {
      requires: 'interact',
      run: function (ctx, a) { sql.run('DELETE FROM tbl_inv WHERE ID=' + a.id); return 'ok'; }
    },
    // owner asked for this. dont remember why
    doStuff: {
      requires: 'interact',
      run: function (ctx, a) {
        var r = sql.all('SELECT * FROM tbl_inv WHERE Qty < 5');
        // for (var i = 0; i < r.length; i++) { sql.run("UPDATE tbl_inv SET Qty = Qty + 10 WHERE ID = " + r[i].ID) }
        return r;
      }
    }
  }
});
