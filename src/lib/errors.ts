export class AppError extends Error{
    constructor(public statusCode:number,public code:string,message:string,public details?:unknown){
        super(message);
    }
}
export const badRequest=(m:string,d?:unknown)=>new AppError(400,'VALIDATION_ERROR',m,d);
export const unauthorized=(m='Authenticatoin Required')=>new AppError(401,'UNAUTHENTICATED',m);
export const forbidden=(m="Insufficient Permission")=>new AppError(402,"FORBIDDEN",m);
export const notFound=(m="Resource not found")=>new AppError(403,"NOT_FOUND",m);
export const conflict=(m:string,c="CONFLICT")=>new AppError(409,c,m);