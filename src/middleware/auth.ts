import type { Request,Response,NextFunction } from "express";
import { adminClient,userClient } from "../config/supabase.js";
import { unauthorized,forbidden } from "../lib/errors.js";
import type { SupabaseClient } from "@supabase/supabase-js";

declare global{
    namespace Express{
        interface Request{
            user?:{id:string,role:'SELLER'|'CUSTOMER'};
            db?:SupabaseClient;
        }
    }
}

export async function authenticate(req:Request,_res:Response,next:NextFunction) {
    try{
        const header=req.headers.authorization;
        if(!header?.startsWith('Bearer ')) throw unauthorized('Missing Bearer Token');
        const token=header.slice(7)
        const {data,error}=await adminClient.auth.getUser(token);
        if(error||!data.user) throw unauthorized('Invalid or Expired token');
        const db=userClient(token);
        const {data:profile,error:pErr}=await db
        .from('profiles')
        .select('id,role')
        .eq('id',data.user.id)
        .single();
        if(pErr||!profile) throw unauthorized('Profile Not Found');
        req.user={id:profile.id,role:profile.role};
        req.db=db;
        next()
    }
    catch(err){next(err)}
}

export function requireRole(role:'SELLER'|'CUSTOMER'){
    return (req:Request,_res:Response,next:NextFunction)=>{
        if(!req.user) return next(unauthorized());
        if(req.user.role!==role) return next(forbidden(`Requires ${role} role`));
        next();
    }
}