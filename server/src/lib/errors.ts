export class AppError extends Error{
    constructor(public statusCode:number,public code:string,message:string,public details?:unknown){
        super(message);
    }
}
export const badRequest=(m:string,d?:unknown)=>new AppError(400,'VALIDATION_ERROR',m,d);
export const unauthorized=(m='Authenticatoin Required')=>new AppError(401,'UNAUTHENTICATED',m);
export const forbidden=(m="Insufficient Permission")=>new AppError(403,"FORBIDDEN",m);
export const notFound=(m="Resource not found",d?:unknown)=>new AppError(404,"NOT_FOUND",m,d);
export const conflict=(m:string,c="CONFLICT",d?:unknown)=>new AppError(409,c,m,d);