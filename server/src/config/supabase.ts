import {createClient} from "@supabase/supabase-js";
import "dotenv/config";

const url=process.env.SUPABASE_URL!;
const publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY!;
const secretKey=process.env.SUPABASE_SECRET_KEY!;

if(!url||!publishableKey||!secretKey){
    throw new Error('Missing Supabase Enviroment Variables');
}

export const userClient=(accessToken:String)=>
    createClient(url,publishableKey,{
        global:{headers:{Authorization:`Bearer ${accessToken}`}},
        auth:{persistSession:false,autoRefreshToken:false}
    });

export const adminClient=createClient(url,secretKey,{
    auth:{persistSession:false,autoRefreshToken:false}
});