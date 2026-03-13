export interface NewsPost {
    id: number;
    title: string;
    category: string;
    date: string;
    content: string;
}

export interface UpdateItem {
    id: number;
    title: string;
    date: string;
}

export interface ForumThread {
    id: number;
    title: string;
    author: string;
    replies: number;
    category: string;
    createdAt?: string;
}

export interface ShopItem {
    id: number;
    name: string;
    price: number;
    description: string;
}

export interface WikiArticle {
    id: number;
    title: string;
    category: string;
    content: string;
    createdAt: string;
}

export interface AuthUser {
    id: number;
    username: string;
    role: string;
    templeCoins: number;
    pfp: string;
    bio: string;
}
