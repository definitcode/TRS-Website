import jwt from 'jsonwebtoken';

const API = 'http://localhost:3001/api';
const SECRET = 'temple_rs_secret_change_in_prod';

async function test() {
    // Manually create a token for 'admin' (ID 1773358230332) from users.json
    const token = jwt.sign({ id: 1773358230332, username: 'admin', role: 'admin' }, SECRET);

    console.log('Testing news post creation...');
    let res = await fetch(`${API}/news`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            title: 'Test News Post',
            category: 'Update',
            content: 'This is a test news post content.'
        })
    });

    if (!res.ok) {
        console.error('Failed to create news post:', res.status, await res.text());
        return;
    }

    const news = await res.json();
    console.log('News post created:', news);

    console.log('Testing news post update (edit)...');
    res = await fetch(`${API}/news/${news.id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            name: 'Updated Test News Post',
            title: 'Updated Test News Post',
            category: 'Update',
            content: 'This is updated content.'
        })
    });

    if (!res.ok) {
        console.error('Failed to update news post:', res.status, await res.text());
    } else {
        const updatedNews = await res.json();
        console.log('News post updated successfully:', updatedNews);
    }
}

test();
