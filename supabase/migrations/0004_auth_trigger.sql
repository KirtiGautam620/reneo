create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
    insert into profiles(id,role,full_name)
    values(
        new.id,
        coalesce(new.raw_user_meta_data ->> 'role','CUSTOMER')::user_role,
        coalesce(new.raw_user_meta_data ->> 'full_name','Unnamed')
    );
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();