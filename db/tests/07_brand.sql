-- =====================================================================
-- Tests de la marca de cada estudio (Sprint 2 · migración 1100)
-- Los colores válidos e inválidos son los mismos que src/lib/brand.test.ts.
-- =====================================================================
\ir lib/setup.sql

-- ---------------------------------------------------------------------
-- Matemática de contraste (mismos valores de referencia que color.test.ts)
-- ---------------------------------------------------------------------
:as_super
select tests.ok(abs(app.contrast_ratio('#ffffff', '#000000') - 21) < 0.0001, 'contraste: blanco/negro = 21');
select tests.ok(abs(app.contrast_ratio('#777777', '#ffffff') - 4.48) < 0.01, 'contraste: #777 sobre blanco ≈ 4.48');
select tests.ok(abs(app.contrast_ratio('#767676', '#ffffff') - 4.54) < 0.01, 'contraste: #767676 sobre blanco ≈ 4.54');
select tests.ok(abs(app.contrast_ratio('#0000ff', '#ffffff') - 8.59) < 0.01, 'contraste: azul sobre blanco ≈ 8.59');

-- ---------------------------------------------------------------------
-- Colores válidos e inválidos (la dueña de A edita su marca)
-- ---------------------------------------------------------------------
:as_owner_a
update public.tenant_settings set brand = '{"primary": "#D4A5A5", "accent": "#c9a48c", "background": "#1a1416", "enabled": true}' where tenant_id = :A;
select tests.ok((select brand = '{"primary": "#d4a5a5", "accent": "#c9a48c", "background": "#1a1416", "enabled": true}'::jsonb
                 from public.tenant_settings where tenant_id = :A),
                'marca válida: se guarda normalizada (hex en minúsculas)');
update public.tenant_settings set brand = '{"primary": "#e91e63"}' where tenant_id = :A;
select tests.ok((select brand ->> 'primary' = '#e91e63' from public.tenant_settings where tenant_id = :A),
                'marca válida: rosa medio (texto negro encima)');
update public.tenant_settings set brand = '{"primary": "#888888"}' where tenant_id = :A;
update public.tenant_settings set brand = '{"primary": "#f8bbd0", "background": "#1f1a2e"}' where tenant_id = :A;
update public.tenant_settings set brand = '{"accent": "#b28324"}' where tenant_id = :A;
update public.tenant_settings set brand = '{"enabled": false}' where tenant_id = :A;
update public.tenant_settings set brand = '{}' where tenant_id = :A;
select tests.ok(true, 'marca válida: gris medio, rosa sobre violeta oscuro, acento ocre, marca apagada y vacía');
select tests.throws(format($$update public.tenant_settings set brand = '{"enabled": "si"}' where tenant_id = %L$$, :A),
                    'marca inválida: "marca propia" tiene que ser sí o no', 'sí o no');

select tests.throws(format($$update public.tenant_settings set brand = '{"background": "#f5f0e6"}' where tenant_id = %L$$, :A),
                    'marca inválida: fondo claro (el tema es oscuro)', 'El fondo es demasiado claro');
select tests.throws(format($$update public.tenant_settings set brand = '{"background": "#e91e63"}' where tenant_id = %L$$, :A),
                    'marca inválida: fondo intenso', 'El fondo es demasiado claro');
select tests.throws(format($$update public.tenant_settings set brand = '{"accent": "#1a1416"}' where tenant_id = %L$$, :A),
                    'marca inválida: acento casi igual al fondo', 'acento casi no se ve');
select tests.throws(format($$update public.tenant_settings set brand = '{"primary": "#141012"}' where tenant_id = %L$$, :A),
                    'marca inválida: botón casi igual al fondo', 'no se distinguen del fondo');
select tests.throws(format($$update public.tenant_settings set brand = '{"primary": "red"}' where tenant_id = %L$$, :A),
                    'marca inválida: color que no es hex', '#rrggbb');
select tests.throws(format($$update public.tenant_settings set brand = '{"primary": "#000;}body{display:none"}' where tenant_id = %L$$, :A),
                    'marca inválida: intento de inyectar CSS', '#rrggbb');
select tests.throws(format($$update public.tenant_settings set brand = '{"font": "Comic Sans"}' where tenant_id = %L$$, :A),
                    'marca inválida: clave desconocida', 'desconocido');
select tests.throws(format($$update public.tenant_settings set brand = '"#ffffff"' where tenant_id = %L$$, :A),
                    'marca inválida: no es un objeto', 'objeto');

-- logo_path: solo en la carpeta del propio estudio
select tests.throws(format($$update public.tenant_settings set brand = '{"logo_path": "%s/logo-a1b2c3d4-0000-4000-8000-000000000000.png"}' where tenant_id = %L$$, :B, :A),
                    'logo de la carpeta de OTRO estudio: rechazado', 'logo no es válido');
select tests.throws(format($$update public.tenant_settings set brand = '{"logo_path": "%s/logo-a1b2c3d4-0000-4000-8000-000000000000.svg"}' where tenant_id = %L$$, :A, :A),
                    'logo SVG: rechazado', 'logo no es válido');
update public.tenant_settings
   set brand = jsonb_build_object('logo_path', :A || '/logo-a1b2c3d4-0000-4000-8000-000000000000.png', 'primary', '#e91e63')
 where tenant_id = :A;
select tests.ok((select brand ? 'logo_path' from public.tenant_settings where tenant_id = :A), 'logo de su propia carpeta: aceptado');

:as_anon
select tests.ok((select brand ->> 'primary' = '#e91e63' and brand ? 'logo_path' from public.get_public_studio('fresas')),
                'la página pública recibe la marca del estudio');

-- Sin settings.manage no se cambia la marca
:as_pro_a
select tests.ok((select tests.affected(format($$update public.tenant_settings set brand = '{}' where tenant_id = %L$$, :A))) = 0,
                'profesional A: no puede cambiar la marca');
:as_owner_b
select tests.ok((select tests.affected(format($$update public.tenant_settings set brand = '{}' where tenant_id = %L$$, :A))) = 0,
                'dueña B: no puede cambiar la marca de A');

-- ---------------------------------------------------------------------
-- Storage: bucket "brand"
-- ---------------------------------------------------------------------
:as_super
select tests.ok((select public and file_size_limit = 1048576 and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
                 from storage.buckets where id = 'brand'),
                'bucket brand: público, 1 MB, solo PNG/JPEG/WebP (sin SVG)');
insert into storage.objects (bucket_id, name) values ('brand', :B || '/logo-b0000000-0000-4000-8000-000000000000.png');

:as_owner_a
insert into storage.objects (bucket_id, name) values ('brand', :A || '/logo-a0000000-0000-4000-8000-000000000000.png');
select tests.ok(true, 'dueña A: sube un logo a la carpeta de su estudio');
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('brand', '%s/logo-c0000000-0000-4000-8000-000000000000.png')$$, :B),
                    'dueña A: no puede subir a la carpeta de B', 'row-level security');
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('brand', '%s/script.svg')$$, :A),
                    'dueña A: no puede subir otros nombres ni SVG', 'row-level security');
select tests.throws($$insert into storage.objects (bucket_id, name) values ('brand', '------------------------------------/logo-c0000000-0000-4000-8000-000000000000.png')$$,
                    'dueña A: una carpeta que no es un uuid se rechaza sin romper', 'row-level security');
select tests.ok((select count(*) = 1 from storage.objects where bucket_id = 'brand'),
                'dueña A: al listar el bucket ve solo los logos de su estudio');
select tests.ok((select tests.affected(format($$delete from storage.objects where name = '%s/logo-b0000000-0000-4000-8000-000000000000.png'$$, :B))) = 0,
                'dueña A: no puede borrar el logo de B');
select tests.ok((select tests.affected(format($$delete from storage.objects where name = '%s/logo-a0000000-0000-4000-8000-000000000000.png'$$, :A))) = 1,
                'dueña A: puede borrar su propio logo');

:as_pro_a
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('brand', '%s/logo-d0000000-0000-4000-8000-000000000000.png')$$, :A),
                    'profesional A (sin settings.manage): no puede subir logos', 'row-level security');
:as_anon
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('brand', '%s/logo-e0000000-0000-4000-8000-000000000000.png')$$, :A),
                    'anon: no puede subir logos', 'row-level security');

\ir lib/finish.sql
