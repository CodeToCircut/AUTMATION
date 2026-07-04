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
    
    if (!Array.isArray(allRepos)) {
      console.error("GITHUB_REPO_ERROR:", allRepos);
      return res.status(500).json({ success: false, error: "Failed to get repos from GitHub" });
    }

    const repoNames = allRepos.map(repo => repo.name);

    for (const repo of repoNames) {
      const trafficResponse = await fetch(`https://api.github.com/repos/${username}/${repo}/traffic/views`, { headers: commonHeaders });
      const trafficData = await trafficResponse.json();
      
      console.log(`DEBUG_GITHUB_${repo}:`, JSON.stringify(trafficData));

      if (!trafficResponse.ok) {
        logs.push({ repo: repo, status: "error", message: `GitHub: ${trafficData.message || 'Error'}` });
        continue; 
      }

      const payload = {
        parent: { database_id: databaseId },
        properties: {
          "Name": { title: [{ text: { content: today } }] },
          "Repository": { rich_text: [{ text: { content: repo } }] },
          "Total Views": { number: trafficData.count || 0 },
          "Unique Visitors": { number: trafficData.uniques || 0 }
        }
      };

      const notionResponse = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify(payload)
      });

      const notionResult = await notionResponse.json();

      if (!notionResponse.ok) {
        console.error(`NOTION_FAILURE_${repo}:`, JSON.stringify(notionResult));
        logs.push({ repo: repo, status: "error", message: `Notion: ${notionResult.message}` });
      } else {
        logs.push({ repo: repo, status: "success", message: "Logged." });
      }
    }
    return res.status(200).json({ success: true, details: logs });
  } catch (error) {
    console.error("CRITICAL_CRASH:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
