TRUNCATE _debug_gist;

DO $$
BEGIN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('test', (1 * interval '1 minute')::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('err_int_mul_interval', SQLERRM);
END $$;

DO $$
BEGIN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('test', (interval '1 minute' * 1)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('err_interval_mul_int', SQLERRM);
END $$;

DO $$
BEGIN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('test', make_interval(mins => 30)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('err_make_interval', SQLERRM);
END $$;

DO $$
BEGIN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('test', ('2026-01-01'::timestamptz + 30 * interval '1 minute')::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('err_ts_add', SQLERRM);
END $$;

DO $$
BEGIN
  PERFORM tstzrange('2026-01-01'::timestamptz, '2026-01-01'::timestamptz + make_interval(mins => 30), '[)');
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('test', 'tstzrange_ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('err_tstzrange', SQLERRM);
END $$;
