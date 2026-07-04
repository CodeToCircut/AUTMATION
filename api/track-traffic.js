import fetch from 'node-fetch';

function cleanNotionId(input) {
  if (!input) return null;
  let clean = input.replace(/['"]/g, '').trim(); 
  if (clean.includes('?')) clean = clean.split('?')[0]; 
  if (clean.includes('/')) {
    const parts = clean.split('/');
    clean = parts[parts.length - 1]; 
  }
  return clean.replace(/-/g, '');
}

export default async function handler(req, res) {
  const logs = [];
  const today = new Date().toISOString().split('T')[0];

  const rawNotionId = process.env.NOTION_DATABASE_ID;
  const notionToken = process.env.NOTION_TOKEN?.replace(/['"]/g, '').trim();
  const githubToken = process.env.GITHUB_PAT?.replace(/['"]/g, '').trim();
  const username = process.env.GITHUB_USERNAME?.replace(/['"]/g, '').trim();

  if (!username || !githubToken || !notionToken || !rawNotionId) {
    return res.status(400).json({ success: false, error: "Missing Environment Variables." });
  }

  const databaseId = cleanNotionId(rawNotionId);

  try {
    const commonHeaders = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Vercel-Automated-Traffic-App'
    };

    const reposResponse = await fetch(`https://api.github.com/user/repos?type=owner&per_page=100`, { headers: commonHeaders });
    const allRepos = await reposResponse.json();
    const repoNames = allRepos.map(repo => repo.name);

    for (const repo of repoNames) {
      const trafficResponse = await fetch(`https://api.github.com/repos/${username}/${repo}/traffic/views`, { headers: commonHeaders });
      if (!trafficResponse.ok) continue;

      const trafficData = await trafficResponse.json();
      const payload = {
        parent: { database_id: databaseId },
        properties: {
          "Name": { title: [{ text: { content: today } }] },
          "Repository": { rich_text: [{ text: { content: repo } }] },
          "Total Views": { number: trafficData.count || 0 },
          "Unique Visitors": { number: trafficData.uniques || 0 }
        }
      };

      // THE DEEP LOGGER: This will now show up in your Vercel logs
      console.log("DEBUG_SENDING_TO_NOTION:", JSON.stringify(payload));

      const notionResponse = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify(payload)
      });

      if (!notionResponse.ok) {
        const err = await notionResponse.json();
        logs.push({ repo: repo, status: "error", message: `Notion Error: ${err.message}` });
      } else {
        logs.push({ repo: repo, status: "success", message: `Logged successfully.` });
      }
    }
    return res.status(200).json({ success: true, details: logs });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
